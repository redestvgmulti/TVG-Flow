import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import pg from 'pg'

const root = new URL('../../', import.meta.url)
const migration = await readFile(
  new URL('supabase/migrations/20260817161000_harden_template_sets_acl.sql', root),
  'utf8',
)
const runtimeEnabled = process.env.RUN_LOCAL_TEMPLATE_SETS_ACL_SQL === '1'
const connection = {
  host: process.env.LOCAL_PG_HOST || '127.0.0.1',
  port: Number(process.env.LOCAL_PG_PORT || 54322),
  user: process.env.LOCAL_PG_USER || 'postgres',
  password: process.env.LOCAL_PG_PASSWORD || 'postgres',
  database: process.env.LOCAL_PG_DATABASE || 'postgres',
}

test('template_sets ACL migration removes the public bypass without changing data or RLS mode', () => {
  assert.match(migration, /DROP POLICY IF EXISTS "Ap Template Sets Full Access" ON ap\.template_sets/)
  assert.match(migration, /REVOKE ALL ON TABLE ap\.template_sets FROM PUBLIC/)
  assert.match(migration, /REVOKE ALL ON TABLE ap\.template_sets FROM anon/)
  assert.match(migration, /REVOKE ALL ON TABLE ap\.template_sets FROM authenticated/)
  assert.match(migration, /GRANT ALL ON TABLE ap\.template_sets TO service_role/)
  assert.doesNotMatch(migration, /\b(INSERT|UPDATE|DELETE|ALTER TABLE|CREATE POLICY|FORCE ROW LEVEL SECURITY)\b/i)
})

test('template_sets blocks direct anon/authenticated access but preserves service-role DML and three rows', {
  skip: !runtimeEnabled,
}, async () => {
  const databaseName = `tvg_template_acl_${randomUUID().replaceAll('-', '')}`
  const admin = new pg.Client(connection)
  let client
  await admin.connect()

  try {
    const roles = await admin.query(
      "SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role')",
    )
    assert.equal(roles.rowCount, 3, 'the runtime test requires a local Supabase Postgres cluster')
    await admin.query(`CREATE DATABASE \"${databaseName}\"`)
    client = new pg.Client({ ...connection, database: databaseName })
    await client.connect()
    await client.query(`
      CREATE SCHEMA ap;
      CREATE TABLE ap.template_sets (
        id uuid PRIMARY KEY,
        empresa_id uuid NOT NULL,
        label text NOT NULL,
        slug text NOT NULL
      );
      ALTER TABLE ap.template_sets ENABLE ROW LEVEL SECURITY;
      CREATE POLICY "Ap Template Sets Full Access" ON ap.template_sets FOR ALL TO public USING (true) WITH CHECK (true);
      GRANT USAGE ON SCHEMA ap TO anon, authenticated, service_role;
      GRANT ALL ON ap.template_sets TO anon, authenticated, service_role;
    `)

    const ids = {
      ownerA: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      ownerB: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      one: '11111111-1111-4111-8111-111111111111',
      two: '22222222-2222-4222-8222-222222222222',
      three: '33333333-3333-4333-8333-333333333333',
      inserted: '44444444-4444-4444-8444-444444444444',
    }
    await client.query(
      `INSERT INTO ap.template_sets (id, empresa_id, label, slug) VALUES
       ($1, $4, 'Default', 'default'),
       ($2, $4, 'Campaign A', 'campaign_a'),
       ($3, $5, 'Campaign B', 'campaign_b')`,
      [ids.one, ids.two, ids.three, ids.ownerA, ids.ownerB],
    )
    const before = await client.query(
      'SELECT jsonb_agg(to_jsonb(template_sets) ORDER BY id) AS snapshot FROM ap.template_sets',
    )

    await client.query(migration)

    const after = await client.query(
      'SELECT jsonb_agg(to_jsonb(template_sets) ORDER BY id) AS snapshot FROM ap.template_sets',
    )
    assert.deepEqual(after.rows[0].snapshot, before.rows[0].snapshot)
    assert.equal(after.rows[0].snapshot.length, 3)

    async function directAs(role, statement, values = []) {
      await client.query(`SET ROLE ${role}`)
      try {
        return await client.query(statement, values)
      } finally {
        await client.query('RESET ROLE')
      }
    }

    for (const role of ['anon', 'authenticated']) {
      await assert.rejects(directAs(role, 'SELECT * FROM ap.template_sets'), /permission denied/i)
      await assert.rejects(
        directAs(role, 'INSERT INTO ap.template_sets (id, empresa_id, label, slug) VALUES ($1, $2, $3, $4)', [ids.inserted, ids.ownerA, 'No', 'no']),
        /permission denied/i,
      )
      await assert.rejects(directAs(role, 'UPDATE ap.template_sets SET label = $1 WHERE id = $2', ['No', ids.one]), /permission denied/i)
      await assert.rejects(directAs(role, 'DELETE FROM ap.template_sets WHERE id = $1', [ids.one]), /permission denied/i)
    }

    const serviceList = await directAs('service_role', 'SELECT id FROM ap.template_sets WHERE empresa_id = $1 ORDER BY id', [ids.ownerA])
    assert.equal(serviceList.rowCount, 2)
    await directAs('service_role', 'INSERT INTO ap.template_sets (id, empresa_id, label, slug) VALUES ($1, $2, $3, $4)', [ids.inserted, ids.ownerA, 'Server', 'server'])
    await directAs('service_role', 'UPDATE ap.template_sets SET label = $1 WHERE id = $2 AND empresa_id = $3', ['Server updated', ids.inserted, ids.ownerA])
    await directAs('service_role', 'DELETE FROM ap.template_sets WHERE id = $1 AND empresa_id = $2', [ids.inserted, ids.ownerA])

    const state = await client.query(`
      SELECT
        c.relrowsecurity AS rls_enabled,
        c.relforcerowsecurity AS rls_forced,
        has_table_privilege('anon', 'ap.template_sets', 'SELECT') AS anon_select,
        has_table_privilege('authenticated', 'ap.template_sets', 'INSERT') AS authenticated_insert,
        has_table_privilege('service_role', 'ap.template_sets', 'DELETE') AS service_delete,
        (SELECT count(*) FROM pg_policies WHERE schemaname = 'ap' AND tablename = 'template_sets') AS policy_count
      FROM pg_class c
      WHERE c.oid = 'ap.template_sets'::regclass
    `)
    assert.deepEqual(state.rows[0], {
      rls_enabled: true,
      rls_forced: false,
      anon_select: false,
      authenticated_insert: false,
      service_delete: true,
      policy_count: '0',
    })
  } finally {
    if (client) await client.end().catch(() => {})
    await admin.query(`DROP DATABASE IF EXISTS \"${databaseName}\" WITH (FORCE)`).catch(() => {})
    await admin.end()
  }
})
