import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import pg from 'pg'

const root = new URL('../../', import.meta.url)
const migration = await readFile(
  new URL('supabase/migrations/20260817160000_add_fail_closed_operational_cliente_resolver.sql', root),
  'utf8',
)
const aclCorrection = await readFile(
  new URL('supabase/migrations/20260817160500_revoke_service_role_from_operational_cliente_resolver.sql', root),
  'utf8',
)
const runtimeEnabled = process.env.RUN_LOCAL_FAIL_CLOSED_CLIENT_SQL === '1'
const connection = {
  host: process.env.LOCAL_PG_HOST || '127.0.0.1',
  port: Number(process.env.LOCAL_PG_PORT || 54322),
  user: process.env.LOCAL_PG_USER || 'postgres',
  password: process.env.LOCAL_PG_PASSWORD || 'postgres',
  database: process.env.LOCAL_PG_DATABASE || 'postgres',
}

test('canonical operational resolver is additive, fail-closed and narrowly granted', () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.require_single_operational_cliente_id\(\)/)
  assert.match(migration, /SECURITY DEFINER/)
  assert.match(migration, /SET search_path = ''/)
  assert.match(migration, /auth\.uid\(\)/)
  assert.match(migration, /public\.profissionais/)
  assert.match(migration, /v_profile\.ativo IS NOT TRUE/)
  assert.match(migration, /ap\.get_operational_cliente_ids\(\)/)
  assert.match(migration, /OPERATIONAL_CLIENT_NOT_FOUND/)
  assert.match(migration, /OPERATIONAL_CLIENT_SELECTION_REQUIRED/)
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.require_single_operational_cliente_id\(\) FROM PUBLIC/)
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.require_single_operational_cliente_id\(\) FROM anon/)
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.require_single_operational_cliente_id\(\)[\s\S]*TO authenticated/)
  assert.doesNotMatch(migration, /\bUPDATE\b|\bDELETE\b|\bINSERT\b|LIMIT\s+1|FROM\s+public\.get_my_cliente_id/i)
})

test('canonical resolver enforces 0/1/N, inactive, anonymous and super-admin cases in PostgreSQL', {
  skip: !runtimeEnabled,
}, async () => {
  const databaseName = `tvg_fail_closed_${randomUUID().replaceAll('-', '')}`
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
      CREATE SCHEMA auth;
      CREATE SCHEMA ap;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
      AS 'SELECT NULLIF(current_setting(''request.jwt.claim.sub'', true), '''')::uuid';
      CREATE TABLE public.profissionais (
        id uuid PRIMARY KEY,
        role text NOT NULL,
        ativo boolean NOT NULL
      );
      CREATE TABLE public.operational_clients (
        profissional_id uuid NOT NULL,
        cliente_id uuid NOT NULL
      );
      CREATE FUNCTION ap.get_operational_cliente_ids() RETURNS SETOF uuid
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, ap, pg_temp
      AS 'SELECT cliente_id FROM public.operational_clients WHERE profissional_id = auth.uid()';
      GRANT USAGE ON SCHEMA public, ap, auth TO anon, authenticated, service_role;
      ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
        GRANT EXECUTE ON FUNCTIONS TO service_role;
    `)
    await client.query(migration)
    await client.query(migration)

    const inheritedDefaultPrivilege = await client.query(`
      SELECT has_function_privilege('service_role', 'public.require_single_operational_cliente_id()', 'EXECUTE') AS service_role
    `)
    assert.equal(inheritedDefaultPrivilege.rows[0].service_role, true)
    await client.query(aclCorrection)

    const ids = {
      one: '11111111-1111-4111-8111-111111111111',
      none: '22222222-2222-4222-8222-222222222222',
      many: '33333333-3333-4333-8333-333333333333',
      inactive: '44444444-4444-4444-8444-444444444444',
      super: '55555555-5555-4555-8555-555555555555',
      clientA: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      clientB: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    }
    await client.query(
      `INSERT INTO public.profissionais (id, role, ativo) VALUES
       ($1, 'admin', true), ($2, 'admin', true), ($3, 'admin', true),
       ($4, 'admin', false), ($5, 'super_admin', true)`,
      [ids.one, ids.none, ids.many, ids.inactive, ids.super],
    )
    await client.query(
      `INSERT INTO public.operational_clients (profissional_id, cliente_id) VALUES
       ($1, $3), ($2, $3), ($2, $4)`,
      [ids.one, ids.many, ids.clientA, ids.clientB],
    )

    async function resolveAs(role, userId) {
      await client.query(`SET ROLE ${role}`)
      try {
        await client.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [userId || ''])
        return await client.query('SELECT public.require_single_operational_cliente_id() AS cliente_id')
      } finally {
        await client.query('RESET ROLE')
        await client.query("SELECT set_config('request.jwt.claim.sub', '', false)")
      }
    }

    assert.equal((await resolveAs('authenticated', ids.one)).rows[0].cliente_id, ids.clientA)
    await assert.rejects(resolveAs('authenticated', ids.none), /OPERATIONAL_CLIENT_NOT_FOUND/)
    await assert.rejects(resolveAs('authenticated', ids.many), /OPERATIONAL_CLIENT_SELECTION_REQUIRED/)
    await assert.rejects(resolveAs('authenticated', ids.inactive), /PROFILE_INACTIVE/)
    await assert.rejects(resolveAs('authenticated', ids.super), /OPERATIONAL_CLIENT_SELECTION_REQUIRED/)
    await assert.rejects(resolveAs('authenticated', null), /AUTH_REQUIRED/)
    await assert.rejects(resolveAs('anon', ids.one), /permission denied/i)
    await assert.rejects(resolveAs('service_role', null), /permission denied/i)

    const privileges = await client.query(`
      SELECT
        has_function_privilege('authenticated', 'public.require_single_operational_cliente_id()', 'EXECUTE') AS authenticated,
        has_function_privilege('service_role', 'public.require_single_operational_cliente_id()', 'EXECUTE') AS service_role,
        has_function_privilege('anon', 'public.require_single_operational_cliente_id()', 'EXECUTE') AS anon
    `)
    assert.deepEqual(privileges.rows[0], { authenticated: true, service_role: false, anon: false })
  } finally {
    if (client) await client.end().catch(() => {})
    await admin.query(`DROP DATABASE IF EXISTS \"${databaseName}\" WITH (FORCE)`).catch(() => {})
    await admin.end()
  }
})
