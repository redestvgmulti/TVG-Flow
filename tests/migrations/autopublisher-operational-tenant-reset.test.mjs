import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import pg from 'pg'

const root = new URL('../../', import.meta.url)
const migrationUrl = new URL(
  'supabase/migrations/20260802213527_autopublisher_visual_catalog_operational_tenant.sql',
  root,
)
const migration = await readFile(migrationUrl, 'utf8')
const runtimeEnabled = process.env.RUN_LOCAL_OPERATIONAL_TENANT_MIGRATION_SQL === '1'
const operationalTenant = 'cd287e6e-f273-4d0f-a72d-2a8c391e40e9'

const connection = {
  host: process.env.LOCAL_PG_HOST || '127.0.0.1',
  port: Number(process.env.LOCAL_PG_PORT || 54322),
  user: process.env.LOCAL_PG_USER || 'postgres',
  password: process.env.LOCAL_PG_PASSWORD || 'postgres',
  database: process.env.LOCAL_PG_DATABASE || 'postgres',
}

const existingMasters = [
  ['feed', 'tvg', 'mzszfje7xdh6l'],
  ['reels', 'tvg', 'xcxtk9tt7syfd'],
  ['feed', 'misto', '3pm4re4blrizh'],
  ['reels', 'misto', 'rrbcykdqcrqae'],
]

const newMasters = [
  ['feed', 'individual', '4e7pghwb4beji'],
  ['reels', 'individual', '5wtiafeuc52hi'],
  ['story', 'story', 'x3djtbqorrtqc'],
  ['reels', 'aparecida', '91gsgmxj1irqh'],
]

async function insertTenant(client, tenantId) {
  await client.query('INSERT INTO public.clientes (id) VALUES ($1)', [tenantId])
}

async function insertExistingMasters(client, rows = existingMasters) {
  for (const [contentType, visualModel, templateUuid] of rows) {
    await client.query(
      `INSERT INTO ap.master_render_configs
        (cliente_id, content_type, visual_model, master_template_uuid, enabled, layer_map)
       VALUES ($1, $2, $3, $4, true, '{}'::jsonb)`,
      [operationalTenant, contentType, visualModel, templateUuid],
    )
  }
}

async function operationalRows(client) {
  return client.query(
    `SELECT content_type, visual_model, master_template_uuid, enabled,
            sponsor_count, layer_map
     FROM ap.master_render_configs
     WHERE cliente_id = $1
     ORDER BY content_type, visual_model`,
    [operationalTenant],
  )
}

test('operational catalog migration is reset-safe but remains tenant-bound and fail-closed', () => {
  assert.match(migration, /AUTOPUBLISHER_OPERATIONAL_TENANT_ABSENT/)
  assert.match(migration, /RAISE NOTICE[\s\S]*?RETURN;/)
  assert.match(migration, /AUTOPUBLISHER_EXISTING_MASTER_SET_INCOMPLETE/)
  assert.match(migration, /AUTOPUBLISHER_EXISTING_MASTER_UUID_MISMATCH/)
  assert.match(migration, /AUTOPUBLISHER_NEW_MASTER_SCOPE_COLLISION/)
  assert.doesNotMatch(migration, /AUTOPUBLISHER_OPERATIONAL_TENANT_NOT_FOUND/)
  assert.doesNotMatch(migration, /EXCEPTION WHEN OTHERS|INSERT INTO public\.clientes/i)
})

test('runtime scenarios preserve empty, complete, partial, divergent and other-tenant states', {
  skip: !runtimeEnabled,
}, async () => {
  const databaseName = `tvg_operational_catalog_${randomUUID().replaceAll('-', '')}`
  assert.match(databaseName, /^[a-z0-9_]+$/)

  const admin = new pg.Client(connection)
  let client
  await admin.connect()

  try {
    await admin.query(`CREATE DATABASE "${databaseName}"`)
    client = new pg.Client({ ...connection, database: databaseName })
    await client.connect()

    await client.query(`
      CREATE SCHEMA ap;
      CREATE TABLE public.clientes (
        id uuid PRIMARY KEY
      );
      CREATE TABLE ap.master_render_configs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        cliente_id uuid NOT NULL REFERENCES public.clientes(id),
        content_type text NOT NULL,
        template_set text,
        visual_model text NOT NULL,
        master_template_uuid text NOT NULL,
        enabled boolean NOT NULL DEFAULT false,
        sponsor_count smallint,
        layer_map jsonb NOT NULL DEFAULT '{}'::jsonb,
        UNIQUE (cliente_id, content_type, visual_model)
      );
    `)

    // Scenario 1: a genuinely empty database receives no operational fixture.
    await client.query(migration)
    assert.equal((await client.query('SELECT count(*) FROM public.clientes')).rows[0].count, '0')
    assert.equal((await client.query('SELECT count(*) FROM ap.master_render_configs')).rows[0].count, '0')

    // Scenarios 2 and 6: another tenant is present and remains byte-for-byte intact.
    const otherTenant = randomUUID()
    await insertTenant(client, otherTenant)
    await client.query(
      `INSERT INTO ap.master_render_configs
        (cliente_id, content_type, visual_model, master_template_uuid, enabled, sponsor_count, layer_map)
       VALUES ($1, 'feed', 'other', 'other-template', true, 0, '{"other":true}'::jsonb)`,
      [otherTenant],
    )
    const otherBefore = (await client.query(
      'SELECT row_to_json(c)::text AS row FROM ap.master_render_configs c WHERE cliente_id = $1',
      [otherTenant],
    )).rows[0].row
    await client.query(migration)
    const otherAfter = (await client.query(
      'SELECT row_to_json(c)::text AS row FROM ap.master_render_configs c WHERE cliente_id = $1',
      [otherTenant],
    )).rows[0].row
    assert.equal(otherAfter, otherBefore)

    // Scenario 3: the exact operational inventory is transformed and replay-safe.
    await insertTenant(client, operationalTenant)
    await insertExistingMasters(client)
    await client.query(migration)
    await client.query(migration)
    const complete = await operationalRows(client)
    assert.equal(complete.rowCount, 8)
    assert.equal(complete.rows.filter(row => row.visual_model === 'misto').length, 0)
    for (const [contentType, visualModel, templateUuid] of newMasters) {
      const row = complete.rows.find(item => (
        item.content_type === contentType && item.visual_model === visualModel
      ))
      assert.ok(row, `missing ${contentType}/${visualModel}`)
      assert.equal(row.master_template_uuid, templateUuid)
      assert.equal(row.enabled, false)
    }

    // Scenario 4: a present tenant with an incomplete legacy inventory aborts atomically.
    await client.query('DELETE FROM ap.master_render_configs WHERE cliente_id = $1', [operationalTenant])
    await insertExistingMasters(client, existingMasters.slice(0, 3))
    await assert.rejects(
      client.query(migration),
      /AUTOPUBLISHER_EXISTING_MASTER_SET_INCOMPLETE expected=4 actual=3/,
    )
    const partial = await operationalRows(client)
    assert.equal(partial.rowCount, 3)
    assert.equal(partial.rows.filter(row => row.visual_model === 'misto').length, 1)

    // Scenario 5: an unexpected target definition aborts and is preserved for inspection.
    await client.query('DELETE FROM ap.master_render_configs WHERE cliente_id = $1', [operationalTenant])
    await insertExistingMasters(client)
    await client.query(
      `INSERT INTO ap.master_render_configs
        (cliente_id, content_type, visual_model, master_template_uuid, enabled, layer_map)
       VALUES ($1, 'feed', 'individual', 'unexpected-template', false, '{"drift":true}'::jsonb)`,
      [operationalTenant],
    )
    await assert.rejects(client.query(migration), /AUTOPUBLISHER_NEW_MASTER_SCOPE_COLLISION/)
    const divergence = await client.query(
      `SELECT master_template_uuid, layer_map
       FROM ap.master_render_configs
       WHERE cliente_id = $1 AND content_type = 'feed' AND visual_model = 'individual'`,
      [operationalTenant],
    )
    assert.equal(divergence.rows[0].master_template_uuid, 'unexpected-template')
    assert.deepEqual(divergence.rows[0].layer_map, { drift: true })
    assert.equal(
      (await client.query(
        `SELECT count(*) FROM ap.master_render_configs
         WHERE cliente_id = $1 AND visual_model = 'misto'`,
        [operationalTenant],
      )).rows[0].count,
      '2',
    )

    const finalOther = (await client.query(
      'SELECT row_to_json(c)::text AS row FROM ap.master_render_configs c WHERE cliente_id = $1',
      [otherTenant],
    )).rows[0].row
    assert.equal(finalOther, otherBefore)
  } finally {
    if (client) await client.end().catch(() => {})
    await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`)
    await admin.end()
  }
})
