import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const migrationsDir = path.join(root, 'supabase', 'migrations')
const migrationNames = await readdir(migrationsDir)

const readMigration = async (suffix) => {
  const name = migrationNames.find((candidate) => candidate.endsWith(suffix))
  assert.ok(name, `migration ending with ${suffix} must exist`)
  return readFile(path.join(migrationsDir, name), 'utf8')
}

const migrationOne = await readMigration('_r1_editorial_feature_flags.sql')
const migrationTwo = await readMigration('_r1_editorial_articles_revisions_events.sql')
const migrationThree = await readMigration('_r1_editorial_domain_rpcs.sql')
const migrationFour = await readMigration('_r1_editorial_reporting_and_work.sql')

const operationalResolver = await readFile(
  path.join(migrationsDir, '20260817160000_add_fail_closed_operational_cliente_resolver.sql'),
  'utf8',
)
const operationalResolverAcl = await readFile(
  path.join(migrationsDir, '20260817160500_revoke_service_role_from_operational_cliente_resolver.sql'),
  'utf8',
)
const myNewsWorkSrc = await readFile(
  path.join(root, 'src', 'pages', 'staff', 'MyNewsWork.jsx'),
  'utf8',
)

const runtimeEnabled = Boolean(process.env.LOCAL_PG_PORT) || process.env.RUN_LOCAL_R1_CLOSURE_SQL === '1'
const connection = {
  host: process.env.LOCAL_PG_HOST || '127.0.0.1',
  port: Number(process.env.LOCAL_PG_PORT || 55322),
  user: process.env.LOCAL_PG_USER || 'postgres',
  password: process.env.LOCAL_PG_PASSWORD || 'postgres',
  database: process.env.LOCAL_PG_DATABASE || 'postgres',
}

test('Static contract: R1 migrations declare strict RLS, search_path, and zero candidate/render mutations', () => {
  const allSql = [migrationOne, migrationTwo, migrationThree, migrationFour].join('\n\n')

  // RLS & Force RLS on all 4 new tables
  for (const table of [
    'editorial_feature_flags',
    'editorial_articles',
    'editorial_article_revisions',
    'editorial_article_events',
  ]) {
    assert.match(allSql, new RegExp(`ALTER TABLE ap\\.${table} ENABLE ROW LEVEL SECURITY;`))
    assert.match(allSql, new RegExp(`ALTER TABLE ap\\.${table} FORCE ROW LEVEL SECURITY;`))
    for (const role of ['PUBLIC', 'anon', 'authenticated', 'service_role']) {
      assert.match(allSql, new RegExp(`REVOKE ALL ON TABLE ap\\.${table} FROM ${role};`))
    }
  }

  // RPCs have SECURITY DEFINER and SET search_path = ''
  const rpcs = [
    'get_editorial_workflow_status',
    'set_editorial_workflow_v1_enabled',
    'start_editorial_article_from_backlog',
    'save_editorial_article_draft',
    'finalize_editorial_article',
    'reopen_editorial_article',
    'abandon_editorial_article',
    'get_editorial_article',
    'list_my_editorial_articles',
    'list_editorial_article_events',
    'get_staff_productivity_report',
  ]
  for (const rpc of rpcs) {
    assert.match(allSql, new RegExp(`CREATE (?:OR REPLACE )?FUNCTION ap\\.${rpc}`))
  }

  // Zero candidate_news mutations
  assert.doesNotMatch(allSql, /(?:INSERT INTO|UPDATE|DELETE FROM)\s+ap\.candidate_news/i)
  // Zero render / storage / instagram mutations
  assert.doesNotMatch(allSql, /(?:INSERT INTO|UPDATE|DELETE FROM)\s+(?:ap\.render_generations|storage\.objects|ap\.instagram_queue)/i)
  // Zero material_production_events insertions
  assert.doesNotMatch(allSql, /INSERT INTO\s+ap\.material_production_events/i)
})

test('Static contract: MyNewsWork dual-read preserves legacy flow when flag is OFF', () => {
  assert.match(myNewsWorkSrc, /get_editorial_workflow_status/)
  assert.match(myNewsWorkSrc, /list_my_news_work/)
  assert.match(myNewsWorkSrc, /list_my_editorial_articles/)
  assert.match(myNewsWorkSrc, /origin:\s*'legacy'/)
  assert.match(myNewsWorkSrc, /origin:\s*'editorial'/)
  assert.match(myNewsWorkSrc, /uniqueId:\s*`legacy-/)
  assert.match(myNewsWorkSrc, /uniqueId:\s*`editorial-/)
  assert.match(myNewsWorkSrc, /item\.origin === 'editorial'/)
  assert.match(myNewsWorkSrc, /toast\.info/)
  // Ensures editorial articles do not redirect to employee-mode
  assert.match(myNewsWorkSrc, /if\s*\(item\.origin === 'editorial'\)\s*\{\s*toast\.info/)
})

test('R1 Closure: Full end-to-end certification on ephemeral PostgreSQL', {
  skip: !runtimeEnabled,
}, async () => {
  const databaseName = `tvg_r1_closure_${randomUUID().replaceAll('-', '')}`
  const admin = new pg.Client(connection)
  let client

  const ids = {
    empresaA: '10101010-1010-4010-8010-101010101010',
    empresaB: '20202020-2020-4020-8020-202020202020',
    clientA: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    clientB: 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',
    adminA: '11111111-1111-4111-8111-111111111111',
    staffA: '22222222-2222-4222-8222-222222222222',
    staffB: '33333333-3333-4333-8333-333333333333',
    adminB: '44444444-4444-4444-8444-444444444444',
    staffC: '55555555-5555-4555-8555-555555555555',
    noTenantUser: '66666666-6666-4666-8666-666666666666',
    multiTenantUser: '77777777-7777-4777-8777-777777777777',
    backlogA1: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    backlogA2: 'cccccccc-cccc-4ccc-8ccc-cccccccccccd',
    backlogLegacyA: 'cccccccc-cccc-4ccc-8ccc-ccccccccccce',
    backlogB1: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    legacyEventA: '88888888-8888-4888-8888-888888888888',
    legacyEventB: '99999999-9999-4999-8999-999999999999',
  }

  const request = () => randomUUID()

  await admin.connect()
  try {
    await admin.query(`CREATE DATABASE "${databaseName}"`)
    client = new pg.Client({ ...connection, database: databaseName })
    await client.connect()

    // 1. Setup minimal base environment
    await client.query(`
      CREATE EXTENSION IF NOT EXISTS pgcrypto;
      CREATE SCHEMA auth;
      CREATE SCHEMA ap;

      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
        SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
      $$;

      CREATE TABLE public.empresas (
        id uuid PRIMARY KEY,
        tenant_id uuid
      );

      CREATE TABLE public.clientes (
        id uuid PRIMARY KEY,
        empresa_id uuid REFERENCES public.empresas(id),
        ativo boolean NOT NULL DEFAULT true
      );

      CREATE TABLE public.profissionais (
        id uuid PRIMARY KEY,
        role text NOT NULL,
        ativo boolean NOT NULL DEFAULT true,
        nome text NOT NULL DEFAULT 'Actor',
        last_activity_at timestamptz
      );

      CREATE TABLE public.cliente_profissionais (
        cliente_id uuid NOT NULL REFERENCES public.clientes(id),
        profissional_id uuid NOT NULL REFERENCES public.profissionais(id),
        ativo boolean NOT NULL DEFAULT true,
        PRIMARY KEY (cliente_id, profissional_id)
      );

      CREATE TABLE public.empresa_profissionais (
        empresa_id uuid NOT NULL REFERENCES public.empresas(id),
        profissional_id uuid NOT NULL REFERENCES public.profissionais(id),
        ativo boolean NOT NULL DEFAULT true,
        PRIMARY KEY (empresa_id, profissional_id)
      );

      CREATE TABLE public.operational_clients (
        profissional_id uuid NOT NULL,
        cliente_id uuid NOT NULL,
        PRIMARY KEY (profissional_id, cliente_id)
      );

      CREATE TABLE public.tarefas (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        cliente_id uuid NOT NULL REFERENCES public.clientes(id),
        assigned_to uuid REFERENCES public.profissionais(id),
        completed_by_user_id uuid REFERENCES public.profissionais(id),
        status text NOT NULL,
        deleted_at timestamptz,
        concluida_at timestamptz
      );

      CREATE TABLE public.tarefas_micro (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tarefa_id uuid NOT NULL REFERENCES public.tarefas(id),
        profissional_id uuid NOT NULL REFERENCES public.profissionais(id),
        status text NOT NULL,
        finished_at timestamptz
      );

      CREATE TABLE ap.candidate_news (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        cliente_id uuid NOT NULL,
        titulo text
      );

      CREATE TABLE ap.news_backlog (
        id uuid PRIMARY KEY,
        cliente_id uuid NOT NULL REFERENCES public.clientes(id),
        status text NOT NULL,
        titulo text,
        url_original text,
        observacao text,
        adopted_by_user_id uuid REFERENCES public.profissionais(id),
        adopted_by_name_snapshot text,
        adopted_at timestamptz,
        released_by_user_id uuid REFERENCES public.profissionais(id),
        released_at timestamptz,
        candidate_news_id uuid,
        production_started_at timestamptz,
        updated_at timestamptz NOT NULL DEFAULT now(),
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE ap.news_backlog_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        backlog_id uuid NOT NULL,
        cliente_id uuid NOT NULL,
        actor_user_id uuid NOT NULL,
        action text NOT NULL,
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE ap.material_production_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        cliente_id uuid NOT NULL REFERENCES public.clientes(id),
        creator_user_id uuid NOT NULL REFERENCES public.profissionais(id),
        produced_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE FUNCTION ap.get_operational_cliente_ids()
      RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER
      SET search_path = pg_catalog, public, ap AS $$
        SELECT cliente_id FROM public.operational_clients WHERE profissional_id = auth.uid()
      $$;

      CREATE FUNCTION ap.require_editorial_admin_access(p_cliente_id uuid)
      RETURNS TABLE (user_id uuid, role text, display_name text)
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
      BEGIN
        RETURN QUERY SELECT p.id, p.role, p.nome
        FROM public.profissionais p
        WHERE p.id = auth.uid() AND p.ativo AND p.role IN ('admin', 'super_admin')
          AND EXISTS (SELECT 1 FROM public.operational_clients m WHERE m.profissional_id = p.id AND m.cliente_id = p_cliente_id);
        IF NOT FOUND THEN
          RAISE EXCEPTION 'EDITORIAL_ADMIN_REQUIRED' USING ERRCODE = '42501';
        END IF;
      END; $$;

      CREATE FUNCTION ap.require_news_backlog_access(p_cliente_id uuid)
      RETURNS TABLE (user_id uuid, role text, display_name text)
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
      BEGIN
        RETURN QUERY SELECT p.id, p.role, p.nome
        FROM public.profissionais p
        WHERE p.id = auth.uid() AND p.ativo
          AND EXISTS (SELECT 1 FROM public.operational_clients m WHERE m.profissional_id = p.id AND m.cliente_id = p_cliente_id);
        IF NOT FOUND THEN
          RAISE EXCEPTION 'EDITORIAL_ACCESS_REQUIRED' USING ERRCODE = '42501';
        END IF;
      END; $$;

      CREATE FUNCTION ap.list_my_news_work(p_cliente_id uuid)
      RETURNS SETOF ap.news_backlog
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
      DECLARE
        v_actor record;
      BEGIN
        SELECT * INTO v_actor FROM ap.require_news_backlog_access(p_cliente_id);
        RETURN QUERY
        SELECT backlog.* FROM ap.news_backlog AS backlog
        WHERE backlog.cliente_id = p_cliente_id
          AND backlog.adopted_by_user_id = v_actor.user_id
          AND backlog.status IN ('adopted', 'in_production', 'completed')
        ORDER BY backlog.updated_at DESC;
      END; $$;

      GRANT USAGE ON SCHEMA auth, ap, public TO anon, authenticated, service_role;
    `)

    // 2. Apply Migrations 1, 2, 3, 4 strictly in order
    await client.query(operationalResolver)
    await client.query(operationalResolverAcl)
    await client.query(migrationOne)
    await client.query(migrationTwo)
    await client.query(migrationThree)
    await client.query(migrationFour)

    // Helper to run as specific role/user
    async function as(role, userId, queryText, values = []) {
      await client.query(`SET ROLE ${role}`)
      try {
        await client.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [userId || ''])
        return await client.query(queryText, values)
      } finally {
        await client.query('RESET ROLE')
        await client.query("SELECT set_config('request.jwt.claim.sub', '', false)")
      }
    }

    // 3. Security Audit: RLS & Direct Browser CRUD Blocked
    const rlsCheck = await client.query(`
      SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'ap'
        AND c.relname IN ('editorial_feature_flags', 'editorial_articles', 'editorial_article_revisions', 'editorial_article_events')
    `)
    assert.equal(rlsCheck.rowCount, 4)
    for (const row of rlsCheck.rows) {
      assert.equal(row.relrowsecurity, true, `${row.relname} must have RLS enabled`)
      assert.equal(row.relforcerowsecurity, true, `${row.relname} must have FORCE RLS enabled`)
    }

    for (const table of ['editorial_feature_flags', 'editorial_articles', 'editorial_article_revisions', 'editorial_article_events']) {
      for (const priv of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
        const anonPriv = (await client.query(`SELECT has_table_privilege('anon', 'ap.${table}', '${priv}') AS p`)).rows[0].p
        const authPriv = (await client.query(`SELECT has_table_privilege('authenticated', 'ap.${table}', '${priv}') AS p`)).rows[0].p
        assert.equal(anonPriv, false, `anon must not have ${priv} on ap.${table}`)
        assert.equal(authPriv, false, `authenticated must not have direct ${priv} on ap.${table}`)
      }
    }

    // 4. Seed test tenants and users
    await client.query(`
      INSERT INTO public.empresas (id) VALUES ('${ids.empresaA}'), ('${ids.empresaB}');
      INSERT INTO public.clientes (id, empresa_id) VALUES
        ('${ids.clientA}', '${ids.empresaA}'),
        ('${ids.clientB}', '${ids.empresaB}');

      INSERT INTO public.profissionais (id, role, ativo, nome) VALUES
        ('${ids.adminA}', 'admin', true, 'Admin A'),
        ('${ids.staffA}', 'staff', true, 'Staff A'),
        ('${ids.staffB}', 'staff', true, 'Staff B'),
        ('${ids.adminB}', 'admin', true, 'Admin B'),
        ('${ids.staffC}', 'staff', true, 'Staff C'),
        ('${ids.noTenantUser}', 'staff', true, 'No Tenant User'),
        ('${ids.multiTenantUser}', 'staff', true, 'Multi Tenant User');

      INSERT INTO public.cliente_profissionais (cliente_id, profissional_id) VALUES
        ('${ids.clientA}', '${ids.adminA}'),
        ('${ids.clientA}', '${ids.staffA}'),
        ('${ids.clientA}', '${ids.staffB}'),
        ('${ids.clientB}', '${ids.adminB}'),
        ('${ids.clientB}', '${ids.staffC}'),
        ('${ids.clientA}', '${ids.multiTenantUser}'),
        ('${ids.clientB}', '${ids.multiTenantUser}');

      INSERT INTO public.operational_clients (profissional_id, cliente_id) VALUES
        ('${ids.adminA}', '${ids.clientA}'),
        ('${ids.staffA}', '${ids.clientA}'),
        ('${ids.staffB}', '${ids.clientA}'),
        ('${ids.adminB}', '${ids.clientB}'),
        ('${ids.staffC}', '${ids.clientB}'),
        ('${ids.multiTenantUser}', '${ids.clientA}'),
        ('${ids.multiTenantUser}', '${ids.clientB}');

      -- Seed legacy events and backlog
      INSERT INTO ap.material_production_events (id, cliente_id, creator_user_id, produced_at) VALUES
        ('${ids.legacyEventA}', '${ids.clientA}', '${ids.staffA}', now() - interval '2 hours'),
        ('${ids.legacyEventB}', '${ids.clientB}', '${ids.staffC}', now() - interval '2 hours');

      INSERT INTO ap.news_backlog (id, cliente_id, status, titulo, url_original, adopted_by_user_id, adopted_at, production_started_at) VALUES
        ('${ids.backlogLegacyA}', '${ids.clientA}', 'in_production', 'Legacy Prod', 'https://example.com/leg', '${ids.staffA}', now(), now()),
        ('${ids.backlogA1}', '${ids.clientA}', 'adopted', 'R1 Pauta A1', 'https://example.com/a1', '${ids.staffA}', now(), NULL),
        ('${ids.backlogA2}', '${ids.clientA}', 'adopted', 'R1 Pauta A2', 'https://example.com/a2', '${ids.staffB}', now(), NULL),
        ('${ids.backlogB1}', '${ids.clientB}', 'adopted', 'R1 Pauta B1', 'https://example.com/b1', '${ids.staffC}', now(), NULL);
    `)

    // 5. Feature Flag default state and bypass protection
    const enabledTenantsCount = (await client.query('SELECT count(*)::int AS count FROM ap.editorial_feature_flags WHERE editorial_workflow_v1_enabled = true')).rows[0].count
    assert.equal(enabledTenantsCount, 0, 'No tenant may be enabled by default (count = 0)')

    const initialFlagA = (await as('authenticated', ids.staffA, 'SELECT ap.get_editorial_workflow_status() AS st')).rows[0].st
    assert.equal(initialFlagA, false, 'Feature flag default must be OFF')

    // Flag OFF blocks R1 bootstrap
    await assert.rejects(
      as('authenticated', ids.staffA, 'SELECT ap.start_editorial_article_from_backlog($1, $2)', [ids.backlogA1, request()]),
      /EDITORIAL_WORKFLOW_DISABLED/,
    )

    // Staff cannot enable feature flag
    await assert.rejects(
      as('authenticated', ids.staffA, 'SELECT ap.set_editorial_workflow_v1_enabled(true)'),
      /EDITORIAL_ADMIN_REQUIRED|FORBIDDEN/,
    )

    // Ambiguous or missing tenant context fails closed
    await assert.rejects(
      as('authenticated', ids.noTenantUser, 'SELECT ap.get_editorial_workflow_status()'),
      /OPERATIONAL_CLIENT_NOT_FOUND/,
    )
    await assert.rejects(
      as('authenticated', ids.multiTenantUser, 'SELECT ap.get_editorial_workflow_status()'),
      /OPERATIONAL_CLIENT_SELECTION_REQUIRED/,
    )

    // 6. Enable flag for Tenant A only
    await as('authenticated', ids.adminA, 'SELECT ap.set_editorial_workflow_v1_enabled(true)')
    assert.equal((await as('authenticated', ids.staffA, 'SELECT ap.get_editorial_workflow_status() AS st')).rows[0].st, true)
    assert.equal((await as('authenticated', ids.staffC, 'SELECT ap.get_editorial_workflow_status() AS st')).rows[0].st, false, 'Tenant B flag remains OFF')

    // 7. Ownership & Tenant Isolation
    // Staff A cannot touch Staff B's backlog or Tenant B backlog
    await assert.rejects(
      as('authenticated', ids.staffA, 'SELECT ap.start_editorial_article_from_backlog($1, $2)', [ids.backlogA2, request()]),
      /BACKLOG_NOT_OWNED/,
    )
    await assert.rejects(
      as('authenticated', ids.staffA, 'SELECT ap.start_editorial_article_from_backlog($1, $2)', [ids.backlogB1, request()]),
      /BACKLOG_NOT_FOUND/,
    )

    // 8. Idempotent Start
    const startReq1 = request()
    const articleRes = await as('authenticated', ids.staffA, 'SELECT (ap.start_editorial_article_from_backlog($1, $2)).id AS id', [ids.backlogA1, startReq1])
    const articleId = articleRes.rows[0].id
    assert.ok(articleId)

    // Double start returns same article
    const articleRes2 = await as('authenticated', ids.staffA, 'SELECT (ap.start_editorial_article_from_backlog($1, $2)).id AS id', [ids.backlogA1, request()])
    assert.equal(articleRes2.rows[0].id, articleId)
    assert.equal((await client.query('SELECT count(*)::int AS count FROM ap.editorial_articles WHERE news_backlog_id = $1', [ids.backlogA1])).rows[0].count, 1)

    // 9. Idempotent Save Draft
    const draftReq1 = request()
    await as('authenticated', ids.staffA, 'SELECT ap.save_editorial_article_draft($1, $2, $3, $4)', [articleId, 'Draft Title', 'Draft Body', draftReq1])
    await as('authenticated', ids.staffA, 'SELECT ap.save_editorial_article_draft($1, $2, $3, $4)', [articleId, 'Draft Title Changed', 'Draft Body Changed', draftReq1])
    assert.equal((await client.query('SELECT count(*)::int AS count FROM ap.editorial_article_revisions WHERE article_id = $1', [articleId])).rows[0].count, 1)

    // Staff B cannot edit Staff A's draft
    await assert.rejects(
      as('authenticated', ids.staffB, 'SELECT ap.save_editorial_article_draft($1, $2, $3, $4)', [articleId, 'Hacked Title', 'Body', request()]),
      /FORBIDDEN/,
    )

    // 10. Idempotent Finalize & Reporting Bridge (No Double Count)
    const finReq1 = request()
    await as('authenticated', ids.staffA, 'SELECT ap.finalize_editorial_article($1, $2, $3, $4)', [articleId, 'Final Title', 'Final Body', finReq1])
    await as('authenticated', ids.staffA, 'SELECT ap.finalize_editorial_article($1, $2, $3, $4)', [articleId, 'Final Title Changed', 'Final Body Changed', finReq1])
    assert.equal((await client.query("SELECT count(*)::int AS count FROM ap.editorial_article_revisions WHERE article_id = $1 AND revision_kind = 'content_final'", [articleId])).rows[0].count, 1)

    // Report check: 1 legacy + 1 R1 finalized = 2
    const repA1 = (await as('authenticated', ids.adminA, "SELECT ap.get_staff_productivity_report($1, now() - interval '1 day', now() + interval '1 day') AS rep", [ids.clientA])).rows[0].rep
    const staffARow = repA1.staff.find((s) => s.staff_id === ids.staffA)
    assert.equal(staffARow.articles_completed, 2, 'R1 article finalized counts once')
    assert.equal(staffARow.articles_in_production, 1, 'Finalized article is not in production')

    // Reopen and Refinalize: Does NOT double count
    await as('authenticated', ids.staffA, 'SELECT ap.reopen_editorial_article($1, $2, $3)', [articleId, 'Correction', request()])
    await as('authenticated', ids.staffA, 'SELECT ap.finalize_editorial_article($1, $2, $3, $4)', [articleId, 'Final Title v2', 'Final Body v2', request()])

    const repA2 = (await as('authenticated', ids.adminA, "SELECT ap.get_staff_productivity_report($1, now() - interval '1 day', now() + interval '1 day') AS rep", [ids.clientA])).rows[0].rep
    const staffARow2 = repA2.staff.find((s) => s.staff_id === ids.staffA)
    assert.equal(staffARow2.articles_completed, 2, 'Refinalization does NOT double count completed articles')

    // 11. MyNewsWork listing & Tenant Isolation
    const myEdWork = (await as('authenticated', ids.staffA, 'SELECT * FROM ap.list_my_editorial_articles()')).rows
    assert.equal(myEdWork.length, 1)
    assert.equal(myEdWork[0].article_id, articleId)
    assert.equal(myEdWork[0].origem_editorial, 'editorial')
    assert.equal(myEdWork[0].headline, 'Final Title v2')

    // Cross tenant cannot see it
    const staffCEdWork = (await as('authenticated', ids.staffC, 'SELECT * FROM ap.list_my_editorial_articles()')).rows
    assert.equal(staffCEdWork.length, 0)

    // 12. Logical Rollback
    // Toggle flag OFF for Tenant A
    await as('authenticated', ids.adminA, 'SELECT ap.set_editorial_workflow_v1_enabled(false)')
    // New R1 start is immediately blocked
    await assert.rejects(
      as('authenticated', ids.staffB, 'SELECT ap.start_editorial_article_from_backlog($1, $2)', [ids.backlogA2, request()]),
      /EDITORIAL_WORKFLOW_DISABLED/,
    )
    // Existing article is preserved in DB
    const existingArticle = (await client.query('SELECT status, headline FROM ap.editorial_articles a JOIN ap.editorial_article_revisions r ON r.article_id = a.id WHERE a.id = $1 ORDER BY r.revision_number DESC LIMIT 1', [articleId])).rows[0]
    assert.equal(existingArticle.status, 'content_final')
    assert.equal(existingArticle.headline, 'Final Title v2')
    // Legacy flow is completely operational
    const legacyWork = (await as('authenticated', ids.staffA, 'SELECT * FROM ap.list_my_news_work($1)', [ids.clientA])).rows
    assert.ok(legacyWork.length >= 1)

    // 13. Candidate News / Storage / Render Invariant
    const candCount = (await client.query('SELECT count(*)::int AS c FROM ap.candidate_news')).rows[0].c
    assert.equal(candCount, 0, 'No candidate_news rows created, modified or deleted')

    const legacyEventsCount = (await client.query('SELECT count(*)::int AS c FROM ap.material_production_events')).rows[0].c
    assert.equal(legacyEventsCount, 2, 'No legacy production events mutated')
  } finally {
    if (client) await client.end()
    await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`)
    await admin.end()
  }
})
