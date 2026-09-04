import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const migrationsDir = path.join(root, 'supabase', 'migrations')
const migrationName = (await readdir(migrationsDir)).find((name) =>
  /_r1_editorial_feature_flags\.sql$/.test(name),
)

assert.ok(migrationName, 'R1 editorial feature flag migration must exist')
const migration = await readFile(path.join(migrationsDir, migrationName), 'utf8')
const operationalResolver = await readFile(
  path.join(migrationsDir, '20260817160000_add_fail_closed_operational_cliente_resolver.sql'),
  'utf8',
)
const operationalResolverAcl = await readFile(
  path.join(migrationsDir, '20260817160500_revoke_service_role_from_operational_cliente_resolver.sql'),
  'utf8',
)
const runtimeEnabled = process.env.RUN_LOCAL_R1_FEATURE_FLAG_SQL === '1'
const connection = {
  host: process.env.LOCAL_PG_HOST || '127.0.0.1',
  port: Number(process.env.LOCAL_PG_PORT || 54322),
  user: process.env.LOCAL_PG_USER || 'postgres',
  password: process.env.LOCAL_PG_PASSWORD || 'postgres',
  database: process.env.LOCAL_PG_DATABASE || 'postgres',
}

test('R1 editorial feature flag is private, tenant-scoped and default-off', () => {
  assert.match(migration, /CREATE TABLE ap\.editorial_feature_flags/)
  assert.match(migration, /cliente_id uuid PRIMARY KEY\s+REFERENCES public\.clientes\(id\)/)
  assert.match(migration, /editorial_workflow_v1_enabled boolean NOT NULL DEFAULT false/)
  assert.match(migration, /updated_by_user_id uuid NOT NULL\s+REFERENCES public\.profissionais\(id\)/)
  assert.match(migration, /updated_at timestamptz NOT NULL DEFAULT now\(\)/)
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/)
  assert.match(migration, /FORCE ROW LEVEL SECURITY/)
  assert.doesNotMatch(migration, /CREATE POLICY/i)
  assert.doesNotMatch(migration, /ap\.system_config/i)
  assert.doesNotMatch(migration, /ap\.(?:candidate_news|news_backlog|collected_news)/i)
})

test('R1 editorial feature flag blocks direct browser and anonymous table access', () => {
  for (const role of ['PUBLIC', 'anon', 'authenticated', 'service_role']) {
    assert.match(
      migration,
      new RegExp(`REVOKE ALL ON TABLE ap\\.editorial_feature_flags FROM ${role};`),
    )
  }
  assert.doesNotMatch(
    migration,
    /GRANT\s+(?:ALL|SELECT|INSERT|UPDATE|DELETE)\s+ON TABLE ap\.editorial_feature_flags\s+TO\s+(?:anon|authenticated)/i,
  )
})

test('read RPC resolves the caller tenant server-side and returns OFF for no row', () => {
  const readFunction = migration.match(
    /CREATE FUNCTION ap\.get_editorial_workflow_status\(\)[\s\S]*?\$function\$;/,
  )?.[0]
  assert.ok(readFunction)
  assert.match(readFunction, /RETURNS boolean/)
  assert.match(readFunction, /SECURITY DEFINER/)
  assert.match(readFunction, /SET search_path = ''/)
  assert.match(readFunction, /public\.require_single_operational_cliente_id\(\)/)
  assert.match(readFunction, /COALESCE\([\s\S]*?, false\)/)
  assert.match(migration, /CREATE FUNCTION ap\.get_editorial_workflow_status\(\)\s+RETURNS boolean/)
  assert.match(migration, /REVOKE ALL ON FUNCTION ap\.get_editorial_workflow_status\(\) FROM PUBLIC;/)
  assert.match(migration, /REVOKE ALL ON FUNCTION ap\.get_editorial_workflow_status\(\) FROM anon;/)
  assert.match(migration, /GRANT EXECUTE ON FUNCTION ap\.get_editorial_workflow_status\(\) TO authenticated;/)
})

test('write RPC is tenant-derived, admin-gated and accepts no tenant identifier', () => {
  const writeFunction = migration.match(
    /CREATE FUNCTION ap\.set_editorial_workflow_v1_enabled\([\s\S]*?\$function\$;/,
  )?.[0]
  assert.ok(writeFunction)
  assert.match(writeFunction, /p_editorial_workflow_v1_enabled boolean/)
  assert.match(writeFunction, /public\.require_single_operational_cliente_id\(\)/)
  assert.match(writeFunction, /ap\.require_editorial_admin_access\(v_cliente_id\)/)
  assert.match(writeFunction, /ON CONFLICT \(cliente_id\) DO UPDATE/)
  assert.match(writeFunction, /updated_by_user_id = EXCLUDED\.updated_by_user_id/)
  assert.match(writeFunction, /updated_at = EXCLUDED\.updated_at/)
  assert.match(
    migration,
    /CREATE FUNCTION ap\.set_editorial_workflow_v1_enabled\(\s*p_editorial_workflow_v1_enabled boolean\s*\)/,
  )
  assert.match(migration, /REVOKE ALL ON FUNCTION ap\.set_editorial_workflow_v1_enabled\(boolean\) FROM PUBLIC;/)
  assert.match(migration, /REVOKE ALL ON FUNCTION ap\.set_editorial_workflow_v1_enabled\(boolean\) FROM anon;/)
  assert.match(migration, /GRANT EXECUTE ON FUNCTION ap\.set_editorial_workflow_v1_enabled\(boolean\) TO authenticated;/)
})

test('R1 feature flag SQL runtime enforces tenant, role and direct-access boundaries', {
  skip: !runtimeEnabled,
}, async () => {
  const databaseName = `tvg_r1_flags_${randomUUID().replaceAll('-', '')}`
  const admin = new pg.Client(connection)
  let client
  await admin.connect()

  const ids = {
    adminA: '11111111-1111-4111-8111-111111111111',
    staffA: '22222222-2222-4222-8222-222222222222',
    noTenant: '33333333-3333-4333-8333-333333333333',
    multiTenant: '44444444-4444-4444-8444-444444444444',
    superAdmin: '55555555-5555-4555-8555-555555555555',
    clientA: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    clientB: 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',
  }

  try {
    const roles = await admin.query(
      "SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role')",
    )
    assert.equal(roles.rowCount, 3, 'the runtime test requires local Supabase roles')
    await admin.query(`CREATE DATABASE \"${databaseName}\"`)
    client = new pg.Client({ ...connection, database: databaseName })
    await client.connect()
    await client.query(`
      CREATE SCHEMA auth;
      CREATE SCHEMA ap;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
      AS 'SELECT NULLIF(current_setting(''request.jwt.claim.sub'', true), '''')::uuid';
      CREATE TABLE public.profissionais (
        id uuid PRIMARY KEY,
        role text NOT NULL,
        ativo boolean NOT NULL,
        nome text NOT NULL DEFAULT 'Test actor'
      );
      CREATE TABLE public.clientes (id uuid PRIMARY KEY, ativo boolean NOT NULL DEFAULT true);
      CREATE TABLE public.operational_clients (
        profissional_id uuid NOT NULL,
        cliente_id uuid NOT NULL
      );
      CREATE FUNCTION ap.get_operational_cliente_ids() RETURNS SETOF uuid
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, ap
      AS 'SELECT cliente_id FROM public.operational_clients WHERE profissional_id = auth.uid()';
      CREATE FUNCTION ap.require_editorial_admin_access(p_cliente_id uuid)
      RETURNS TABLE (user_id uuid, role text, display_name text)
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
      AS $$
      BEGIN
        RETURN QUERY
        SELECT professional.id, professional.role, professional.nome
          FROM public.profissionais AS professional
         WHERE professional.id = auth.uid()
           AND professional.ativo IS TRUE
           AND professional.role = 'admin'
           AND EXISTS (
             SELECT 1 FROM public.operational_clients AS membership
              WHERE membership.profissional_id = professional.id
                AND membership.cliente_id = p_cliente_id
           );
        IF NOT FOUND THEN
          RAISE EXCEPTION 'EDITORIAL_ADMIN_REQUIRED' USING ERRCODE = '42501';
        END IF;
      END;
      $$;
      GRANT USAGE ON SCHEMA auth, ap, public TO anon, authenticated, service_role;
      ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA ap
        GRANT EXECUTE ON FUNCTIONS TO service_role;
    `)
    await client.query(operationalResolver)
    await client.query(operationalResolverAcl)
    await client.query(migration)
    await client.query(
      `INSERT INTO public.profissionais (id, role, ativo) VALUES
       ($1, 'admin', true), ($2, 'staff', true), ($3, 'admin', true),
       ($4, 'admin', true), ($5, 'super_admin', true)`,
      [ids.adminA, ids.staffA, ids.noTenant, ids.multiTenant, ids.superAdmin],
    )
    await client.query(
      'INSERT INTO public.clientes (id) VALUES ($1), ($2)',
      [ids.clientA, ids.clientB],
    )
    await client.query(
      `INSERT INTO public.operational_clients (profissional_id, cliente_id) VALUES
       ($1, $4), ($2, $4), ($3, $4), ($3, $5)`,
      [ids.adminA, ids.staffA, ids.multiTenant, ids.clientA, ids.clientB],
    )

    async function as(role, userId, text, values = []) {
      await client.query(`SET ROLE ${role}`)
      try {
        await client.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [userId || ''])
        return await client.query(text, values)
      } finally {
        await client.query('RESET ROLE')
        await client.query("SELECT set_config('request.jwt.claim.sub', '', false)")
      }
    }

    assert.equal(
      (await as('authenticated', ids.adminA, 'SELECT ap.get_editorial_workflow_status() AS enabled')).rows[0].enabled,
      false,
    )
    assert.equal(
      (await as('authenticated', ids.adminA, 'SELECT ap.set_editorial_workflow_v1_enabled(true) AS enabled')).rows[0].enabled,
      true,
    )
    assert.equal(
      (await as('authenticated', ids.adminA, 'SELECT ap.get_editorial_workflow_status() AS enabled')).rows[0].enabled,
      true,
    )
    await assert.rejects(
      as('authenticated', ids.staffA, 'SELECT ap.set_editorial_workflow_v1_enabled(false)'),
      /EDITORIAL_ADMIN_REQUIRED/,
    )
    await assert.rejects(
      as('authenticated', ids.adminA, 'SELECT * FROM ap.editorial_feature_flags'),
      /permission denied/i,
    )
    await assert.rejects(
      as('authenticated', ids.adminA, 'INSERT INTO ap.editorial_feature_flags (cliente_id, updated_by_user_id) VALUES ($1, $2)', [ids.clientB, ids.adminA]),
      /permission denied/i,
    )
    await assert.rejects(
      as('authenticated', ids.adminA, 'SELECT ap.set_editorial_workflow_v1_enabled(true, $1)', [ids.clientB]),
      /function .* does not exist/i,
    )
    await assert.rejects(
      as('authenticated', ids.noTenant, 'SELECT ap.get_editorial_workflow_status()'),
      /OPERATIONAL_CLIENT_NOT_FOUND/,
    )
    await assert.rejects(
      as('authenticated', ids.multiTenant, 'SELECT ap.get_editorial_workflow_status()'),
      /OPERATIONAL_CLIENT_SELECTION_REQUIRED/,
    )
    await assert.rejects(
      as('authenticated', ids.superAdmin, 'SELECT ap.get_editorial_workflow_status()'),
      /OPERATIONAL_CLIENT_SELECTION_REQUIRED/,
    )
    await assert.rejects(
      as('anon', null, 'SELECT ap.get_editorial_workflow_status()'),
      /permission denied/i,
    )

    await client.query(
      'INSERT INTO ap.editorial_feature_flags (cliente_id, updated_by_user_id) VALUES ($1, $2)',
      [ids.clientB, ids.adminA],
    )
    const defaults = await client.query(
      'SELECT cliente_id, editorial_workflow_v1_enabled FROM ap.editorial_feature_flags ORDER BY cliente_id',
    )
    assert.deepEqual(defaults.rows, [
      { cliente_id: ids.clientA, editorial_workflow_v1_enabled: true },
      { cliente_id: ids.clientB, editorial_workflow_v1_enabled: false },
    ])
    const privileges = await client.query(`
      SELECT
        has_table_privilege('anon', 'ap.editorial_feature_flags', 'SELECT,INSERT,UPDATE,DELETE') AS anon_crud,
        has_table_privilege('authenticated', 'ap.editorial_feature_flags', 'SELECT,INSERT,UPDATE,DELETE') AS authenticated_crud,
        has_function_privilege('anon', 'ap.get_editorial_workflow_status()', 'EXECUTE') AS anon_read,
        has_function_privilege('authenticated', 'ap.get_editorial_workflow_status()', 'EXECUTE') AS authenticated_read,
        has_function_privilege('authenticated', 'ap.set_editorial_workflow_v1_enabled(boolean)', 'EXECUTE') AS authenticated_write
    `)
    assert.deepEqual(privileges.rows[0], {
      anon_crud: false,
      authenticated_crud: false,
      anon_read: false,
      authenticated_read: true,
      authenticated_write: true,
    })
  } finally {
    if (client) await client.end().catch(() => {})
    await admin.query(`DROP DATABASE IF EXISTS \"${databaseName}\" WITH (FORCE)`).catch(() => {})
    await admin.end()
  }
})
