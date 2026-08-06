import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import pg from 'pg'

const root = new URL('../../', import.meta.url)
const migration = await readFile(
  new URL('supabase/migrations/20260805193000_fix_get_agencia_cliente_id_tenant_resolution.sql', root),
  'utf8',
)
const baseline = await readFile(
  new URL('supabase/migrations/20260223031956_remote_schema.sql', root),
  'utf8',
)
const runtimeEnabled = process.env.RUN_LOCAL_CLIENTE_TIPO_SQL === '1'

const connection = {
  host: process.env.LOCAL_PG_HOST || '127.0.0.1',
  port: Number(process.env.LOCAL_PG_PORT || 54322),
  user: process.env.LOCAL_PG_USER || 'postgres',
  password: process.env.LOCAL_PG_PASSWORD || 'postgres',
  database: process.env.LOCAL_PG_DATABASE || 'postgres',
}

test('agency resolver uses the canonical company classification and JWT memberships', () => {
  const clientesDefinition = baseline.match(
    /CREATE TABLE IF NOT EXISTS "public"\."clientes" \([\s\S]*?\n\);/,
  )?.[0] || ''

  assert.ok(clientesDefinition)
  assert.doesNotMatch(clientesDefinition, /"tipo"/)
  assert.match(baseline, /"tipo_negocio" "text"/)
  assert.match(
    baseline,
    /"empresas_tipo_negocio_check"[\s\S]*?'agency'[\s\S]*?'studio'[\s\S]*?'producer'[\s\S]*?'other'/,
  )

  assert.match(migration, /FROM ap\.get_user_cliente_ids\(\)/)
  assert.match(migration, /JOIN public\.clientes AS c/)
  assert.match(migration, /JOIN public\.empresas AS e/)
  assert.match(migration, /e\.tipo_negocio = 'agency'/)
  assert.match(migration, /c\.ativo IS TRUE/)
  assert.match(migration, /e\.ativo IS TRUE/)
  assert.match(migration, /auth\.uid\(\)/)
  assert.match(migration, /AGENCY_CLIENT_NOT_FOUND/)
  assert.match(migration, /AGENCY_CLIENT_SELECTION_REQUIRED/)
  const executableMigration = migration.replace(/^--.*$/gm, '')
  assert.doesNotMatch(executableMigration, /clientes\.tipo|c\.tipo|WHERE\s+tipo\s*=/i)
  assert.doesNotMatch(migration, /LIMIT\s+1|USING\s*\(\s*true\s*\)/i)
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.get_agencia_cliente_id\(\) FROM PUBLIC/)
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.get_agencia_cliente_id\(\) FROM anon/)
})

test('agency resolver is tenant-scoped, deterministic and fail-closed', {
  skip: !runtimeEnabled,
}, async () => {
  const databaseName = `tvg_client_type_${randomUUID().replaceAll('-', '')}`
  assert.match(databaseName, /^[a-z0-9_]+$/)

  const admin = new pg.Client(connection)
  let client
  await admin.connect()

  try {
    const roles = await admin.query(
      "SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role')",
    )
    assert.equal(roles.rowCount, 3, 'the runtime test requires a local Supabase Postgres cluster')
    await admin.query(`CREATE DATABASE "${databaseName}"`)

    client = new pg.Client({ ...connection, database: databaseName })
    await client.connect()
    await client.query(`
      CREATE SCHEMA auth;
      CREATE SCHEMA ap;

      CREATE FUNCTION auth.uid()
      RETURNS uuid
      LANGUAGE sql
      STABLE
      AS 'SELECT NULLIF(current_setting(''request.jwt.claim.sub'', true), '''')::uuid';

      CREATE TABLE public.empresas (
        id uuid PRIMARY KEY,
        created_at timestamptz NOT NULL DEFAULT now(),
        ativo boolean NOT NULL DEFAULT true,
        tipo_negocio text CHECK (tipo_negocio IN ('agency', 'studio', 'producer', 'other'))
      );

      CREATE TABLE public.clientes (
        id uuid PRIMARY KEY,
        nome text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        ativo boolean NOT NULL DEFAULT true,
        empresa_id uuid REFERENCES public.empresas(id)
      );

      CREATE TABLE public.cliente_profissionais (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        cliente_id uuid NOT NULL REFERENCES public.clientes(id),
        profissional_id uuid NOT NULL,
        funcao text NOT NULL,
        ativo boolean NOT NULL DEFAULT true
      );

      CREATE FUNCTION ap.get_user_cliente_ids()
      RETURNS SETOF uuid
      LANGUAGE sql
      STABLE
      SECURITY DEFINER
      SET search_path = pg_catalog, public, pg_temp
      AS 'SELECT cp.cliente_id
          FROM public.cliente_profissionais AS cp
          WHERE cp.profissional_id = auth.uid()
            AND cp.ativo IS TRUE';

      GRANT USAGE ON SCHEMA public, auth, ap TO anon, authenticated, service_role;
    `)

    await client.query(migration)
    await client.query(migration)

    const ids = {
      agencyEmpresaA: '10000000-0000-4000-8000-000000000001',
      agencyEmpresaB: '10000000-0000-4000-8000-000000000002',
      studioEmpresa: '10000000-0000-4000-8000-000000000003',
      agencyClienteA: '20000000-0000-4000-8000-000000000001',
      agencyClienteB: '20000000-0000-4000-8000-000000000002',
      studioCliente: '20000000-0000-4000-8000-000000000003',
      singleUser: '30000000-0000-4000-8000-000000000001',
      ambiguousUser: '30000000-0000-4000-8000-000000000002',
      otherTenantUser: '30000000-0000-4000-8000-000000000003',
      noMembershipUser: '30000000-0000-4000-8000-000000000004',
    }

    await client.query(
      `INSERT INTO public.empresas (id, tipo_negocio)
       VALUES ($1, 'agency'), ($2, 'agency'), ($3, 'studio')`,
      [ids.agencyEmpresaA, ids.agencyEmpresaB, ids.studioEmpresa],
    )
    await client.query(
      `INSERT INTO public.clientes (id, nome, empresa_id)
       VALUES ($1, 'Agency A', $2), ($3, 'Agency B', $4), ($5, 'Studio', $6)`,
      [
        ids.agencyClienteA,
        ids.agencyEmpresaA,
        ids.agencyClienteB,
        ids.agencyEmpresaB,
        ids.studioCliente,
        ids.studioEmpresa,
      ],
    )
    await client.query(
      `INSERT INTO public.cliente_profissionais
        (cliente_id, profissional_id, funcao)
       VALUES
        ($1, $2, 'admin'),
        ($3, $2, 'editor'),
        ($1, $4, 'admin'),
        ($5, $4, 'admin'),
        ($5, $6, 'admin')`,
      [
        ids.agencyClienteA,
        ids.singleUser,
        ids.studioCliente,
        ids.ambiguousUser,
        ids.agencyClienteB,
        ids.otherTenantUser,
      ],
    )

    async function resolveAs(role, userId) {
      assert.match(role, /^(anon|authenticated|service_role)$/)
      await client.query(`SET ROLE ${role}`)
      try {
        await client.query(
          "SELECT set_config('request.jwt.claim.sub', $1, false)",
          [userId || ''],
        )
        return await client.query('SELECT public.get_agencia_cliente_id() AS cliente_id')
      } finally {
        await client.query('RESET ROLE')
        await client.query("SELECT set_config('request.jwt.claim.sub', '', false)")
      }
    }

    assert.equal(
      (await resolveAs('authenticated', ids.singleUser)).rows[0].cliente_id,
      ids.agencyClienteA,
      'a non-agency membership must not replace the agency client',
    )
    assert.equal(
      (await resolveAs('authenticated', ids.otherTenantUser)).rows[0].cliente_id,
      ids.agencyClienteB,
      'the resolver must not leak the first global agency client',
    )
    await assert.rejects(
      resolveAs('authenticated', ids.noMembershipUser),
      /AGENCY_CLIENT_NOT_FOUND/,
    )
    await assert.rejects(
      resolveAs('authenticated', ids.ambiguousUser),
      /AGENCY_CLIENT_SELECTION_REQUIRED/,
    )
    await assert.rejects(resolveAs('anon', ids.singleUser), /permission denied/i)
    await assert.rejects(resolveAs('service_role', null), /AUTH_REQUIRED/)

    await client.query('UPDATE public.empresas SET ativo = false WHERE id = $1', [ids.agencyEmpresaA])
    await assert.rejects(
      resolveAs('authenticated', ids.singleUser),
      /AGENCY_CLIENT_NOT_FOUND/,
    )
    await client.query('UPDATE public.empresas SET ativo = true WHERE id = $1', [ids.agencyEmpresaA])

    await client.query('UPDATE public.clientes SET ativo = false WHERE id = $1', [ids.agencyClienteA])
    await assert.rejects(
      resolveAs('authenticated', ids.singleUser),
      /AGENCY_CLIENT_NOT_FOUND/,
    )

    const privileges = await client.query(`
      SELECT
        has_function_privilege('authenticated', 'public.get_agencia_cliente_id()', 'EXECUTE') AS authenticated,
        has_function_privilege('service_role', 'public.get_agencia_cliente_id()', 'EXECUTE') AS service_role,
        has_function_privilege('anon', 'public.get_agencia_cliente_id()', 'EXECUTE') AS anon
    `)
    assert.deepEqual(privileges.rows[0], {
      authenticated: true,
      service_role: true,
      anon: false,
    })

    const definition = await client.query(`
      SELECT p.prosecdef, p.provolatile, pg_get_functiondef(p.oid) AS definition
      FROM pg_proc AS p
      JOIN pg_namespace AS n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = 'get_agencia_cliente_id'
    `)
    assert.equal(definition.rowCount, 1)
    assert.equal(definition.rows[0].prosecdef, true)
    assert.equal(definition.rows[0].provolatile, 's')
    assert.doesNotMatch(definition.rows[0].definition, /clientes\.tipo|c\.tipo/i)
  } finally {
    if (client) await client.end().catch(() => {})
    await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`)
    await admin.end()
  }
})
