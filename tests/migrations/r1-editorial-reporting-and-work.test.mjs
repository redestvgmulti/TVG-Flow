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
// 2B.2.3: the dual-read/dedup logic this suite originally found inline in
// MyNewsWork.jsx was extracted into its own tested module so it could be
// reused by the admin editorial review panel too -- the contract now spans
// both files instead of one.
const editorialWorkNormalizationSrc = await readFile(
  path.join(root, 'src', 'services', 'editorialWorkNormalization.js'),
  'utf8',
)

const runtimeEnabled = process.env.RUN_LOCAL_R1_REPORTING_SQL === '1' || Boolean(process.env.LOCAL_PG_PORT)
const connection = {
  host: process.env.LOCAL_PG_HOST || '127.0.0.1',
  port: Number(process.env.LOCAL_PG_PORT || 55322),
  user: process.env.LOCAL_PG_USER || 'postgres',
  password: process.env.LOCAL_PG_PASSWORD || 'postgres',
  database: process.env.LOCAL_PG_DATABASE || 'postgres',
}

test('Migration 4 defines reporting bridge and list_my_editorial_articles without mutating candidate_news', () => {
  assert.match(migrationFour, /CREATE OR REPLACE FUNCTION ap\.get_staff_productivity_report/)
  assert.match(migrationFour, /CREATE FUNCTION ap\.list_my_editorial_articles/)
  assert.match(migrationFour, /first_finalized_at/)
  assert.match(migrationFour, /SECURITY DEFINER/)
  assert.match(migrationFour, /SET search_path = ''/)
  assert.match(migrationFour, /DROP FUNCTION IF EXISTS ap\.list_my_editorial_articles/)
  assert.match(migrationFour, /GRANT EXECUTE ON FUNCTION ap\.get_staff_productivity_report/)
  assert.match(migrationFour, /GRANT EXECUTE ON FUNCTION ap\.list_my_editorial_articles/)
  assert.doesNotMatch(migrationFour, /(?:INSERT INTO|UPDATE|DELETE FROM)\s+ap\.candidate_news/i)
  assert.doesNotMatch(migrationFour, /material_production_events\s*\(/)
})

test('MyNewsWork frontend implements dual-read with discriminator and safe non-redirecting editorial actions', () => {
  // 2B.2.3: the flag read, the two RPC calls, and the origin/uniqueId
  // dedup logic used to live inline in this file; they were extracted into
  // useEditorialWorkflowFlag / editorialArticlesService / editorialWorkNormalization
  // so the admin editorial review panel could reuse them too. The contract
  // this test enforces is unchanged in spirit -- dual-read, a discriminator,
  // no duplicates -- just verified across the file that now owns each piece.
  assert.match(myNewsWorkSrc, /useEditorialWorkflowFlag/)
  assert.match(myNewsWorkSrc, /list_my_news_work/)
  assert.match(myNewsWorkSrc, /listMyEditorialArticles/)
  assert.match(myNewsWorkSrc, /mergeLegacyAndEditorialWork/)
  assert.match(myNewsWorkSrc, /if\s*\(item\.origin === 'editorial'\)/)
  assert.match(editorialWorkNormalizationSrc, /origin:\s*'legacy'/)
  assert.match(editorialWorkNormalizationSrc, /origin:\s*'editorial'/)
  assert.match(editorialWorkNormalizationSrc, /uniqueId/)
  // "Editorial actions are safe/non-redirecting" now means opening the real
  // canonical editor (2B.2.3) rather than the earlier toast-only placeholder.
  assert.match(myNewsWorkSrc, /CanonicalEditorialEditor/)
  assert.match(myNewsWorkSrc, /operationalStageForEditorialStatus/)
})

test('R1 Migration 4 SQL runtime validates reporting bridge, deduplication, tenant isolation and dual-read', {
  skip: !runtimeEnabled,
}, async () => {
  const databaseName = `tvg_r1_rep_${randomUUID().replaceAll('-', '')}`
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
    backlogA1: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    backlogA2: 'cccccccc-cccc-4ccc-8ccc-cccccccccccd',
    backlogLegacyProd: 'cccccccc-cccc-4ccc-8ccc-ccccccccccce',
    backlogB1: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    legacyEventA: '88888888-8888-4888-8888-888888888888',
    legacyEventB: '77777777-7777-4777-8777-777777777777',
  }

  const request = () => randomUUID()

  await admin.connect()
  try {
    await admin.query(`CREATE DATABASE "${databaseName}"`)
    client = new pg.Client({ ...connection, database: databaseName })
    await client.connect()

    // 1. Setup minimal base tables and functions
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

    // 2. Apply resolvers and Migrations 1, 2, 3, 4
    await client.query(operationalResolver)
    await client.query(operationalResolverAcl)
    await client.query(migrationOne)
    await client.query(migrationTwo)
    await client.query(migrationThree)
    await client.query(migrationFour)

    // 3. Seed test tenants and users
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
        ('${ids.staffC}', 'staff', true, 'Staff C');

      INSERT INTO public.cliente_profissionais (cliente_id, profissional_id) VALUES
        ('${ids.clientA}', '${ids.adminA}'),
        ('${ids.clientA}', '${ids.staffA}'),
        ('${ids.clientA}', '${ids.staffB}'),
        ('${ids.clientB}', '${ids.adminB}'),
        ('${ids.clientB}', '${ids.staffC}');

      INSERT INTO public.operational_clients (profissional_id, cliente_id) VALUES
        ('${ids.adminA}', '${ids.clientA}'),
        ('${ids.staffA}', '${ids.clientA}'),
        ('${ids.staffB}', '${ids.clientA}'),
        ('${ids.adminB}', '${ids.clientB}'),
        ('${ids.staffC}', '${ids.clientB}');

      -- Seed 1 legacy production event in tenant A for staff A
      INSERT INTO ap.material_production_events (id, cliente_id, creator_user_id, produced_at) VALUES
        ('${ids.legacyEventA}', '${ids.clientA}', '${ids.staffA}', now() - interval '1 hour'),
        ('${ids.legacyEventB}', '${ids.clientB}', '${ids.staffC}', now() - interval '1 hour');

      -- Seed legacy backlog in production for staff A
      INSERT INTO ap.news_backlog (id, cliente_id, status, titulo, url_original, adopted_by_user_id, adopted_at, production_started_at) VALUES
        ('${ids.backlogLegacyProd}', '${ids.clientA}', 'in_production', 'Legacy Prod Pauta', 'https://example.com/pauta0', '${ids.staffA}', now(), now()),
        ('${ids.backlogA1}', '${ids.clientA}', 'adopted', 'R1 Backlog Pauta 1', 'https://example.com/pauta1', '${ids.staffA}', now(), NULL),
        ('${ids.backlogA2}', '${ids.clientA}', 'adopted', 'R1 Backlog Pauta 2', 'https://example.com/pauta2', '${ids.staffB}', now(), NULL),
        ('${ids.backlogB1}', '${ids.clientB}', 'adopted', 'Tenant B Backlog Pauta', 'https://example.com/pautaB', '${ids.staffC}', now(), NULL);
    `)

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

    // TEST 1: Relatório legado permanece igual sem artigos R1
    const reportBefore = (await as(
      'authenticated',
      ids.adminA,
      "SELECT ap.get_staff_productivity_report($1, now() - interval '1 day', now() + interval '1 day') AS rep",
      [ids.clientA],
    )).rows[0].rep

    const staffABefore = reportBefore.staff.find((s) => s.staff_id === ids.staffA)
    assert.ok(staffABefore, 'Staff A row exists')
    assert.equal(staffABefore.articles_completed, 1, 'Legacy completed is preserved')
    assert.equal(staffABefore.articles_in_production, 1, 'Legacy in production is preserved')
    assert.equal(staffABefore.articles_adopted, 1, 'Legacy adopted is preserved')

    // TEST 2: Enable R1 feature flag for Tenant A only
    await as('authenticated', ids.adminA, 'SELECT ap.set_editorial_workflow_v1_enabled(true)')

    // TEST 3: Start editorial article from backlog (draft/editing entra em "em produção")
    const startRes = await as(
      'authenticated',
      ids.staffA,
      'SELECT (ap.start_editorial_article_from_backlog($1, $2)).id AS id',
      [ids.backlogA1, request()],
    )
    const articleId = startRes.rows[0].id
    assert.ok(articleId)

    const reportDuringDraft = (await as(
      'authenticated',
      ids.adminA,
      "SELECT ap.get_staff_productivity_report($1, now() - interval '1 day', now() + interval '1 day') AS rep",
      [ids.clientA],
    )).rows[0].rep
    const staffADuringDraft = reportDuringDraft.staff.find((s) => s.staff_id === ids.staffA)

    // Staff A had 1 legacy in_production + 1 R1 article in draft = 2 in_production
    assert.equal(staffADuringDraft.articles_in_production, 2, 'R1 article in draft counts as in_production')
    assert.equal(staffADuringDraft.articles_completed, 1, 'Draft does not count as completed')

    // TEST 4: Finalize editorial article (artigo finalizado entra uma vez)
    await as(
      'authenticated',
      ids.staffA,
      'SELECT (ap.finalize_editorial_article($1, $2, $3, $4)).id AS id',
      [articleId, 'Manchete Editorial', 'Corpo editorial completo', request()],
    )

    const reportAfterFinalize = (await as(
      'authenticated',
      ids.adminA,
      "SELECT ap.get_staff_productivity_report($1, now() - interval '1 day', now() + interval '1 day') AS rep",
      [ids.clientA],
    )).rows[0].rep
    const staffAAfterFinalize = reportAfterFinalize.staff.find((s) => s.staff_id === ids.staffA)

    assert.equal(staffAAfterFinalize.articles_completed, 2, 'Finalized R1 article is counted (1 legacy + 1 R1)')
    assert.equal(staffAAfterFinalize.articles_in_production, 1, 'Finalized article is no longer in_production')

    // TEST 5: Reopen and Refinalize (reopen/refinalize não duplica produtividade)
    await as(
      'authenticated',
      ids.staffA,
      'SELECT (ap.reopen_editorial_article($1, $2, $3)).id AS id',
      [articleId, 'Ajuste pós revisão', request()],
    )

    const reportDuringReopen = (await as(
      'authenticated',
      ids.adminA,
      "SELECT ap.get_staff_productivity_report($1, now() - interval '1 day', now() + interval '1 day') AS rep",
      [ids.clientA],
    )).rows[0].rep
    const staffADuringReopen = reportDuringReopen.staff.find((s) => s.staff_id === ids.staffA)
    // While reopened, first_finalized_at is preserved so articles_completed is still 2!
    assert.equal(staffADuringReopen.articles_completed, 2, 'Articles completed is not lost during reopen')
    assert.equal(staffADuringReopen.articles_in_production, 2, 'Reopened article re-enters in_production')

    // Refinalize with revision 2
    await as(
      'authenticated',
      ids.staffA,
      'SELECT (ap.finalize_editorial_article($1, $2, $3, $4)).id AS id',
      [articleId, 'Manchete Editorial Rev2', 'Corpo corrigido', request()],
    )

    const reportAfterRefinalize = (await as(
      'authenticated',
      ids.adminA,
      "SELECT ap.get_staff_productivity_report($1, now() - interval '1 day', now() + interval '1 day') AS rep",
      [ids.clientA],
    )).rows[0].rep
    const staffAAfterRefinalize = reportAfterRefinalize.staff.find((s) => s.staff_id === ids.staffA)
    assert.equal(staffAAfterRefinalize.articles_completed, 2, 'Articles completed is NOT double-counted on refinalize')
    assert.equal(staffAAfterRefinalize.articles_in_production, 1, 'Refinalized article exits in_production')

    // TEST 6: Tenant isolation: Tenant A não aparece para Tenant B
    const reportTenantB = (await as(
      'authenticated',
      ids.adminB,
      "SELECT ap.get_staff_productivity_report($1, now() - interval '1 day', now() + interval '1 day') AS rep",
      [ids.clientB],
    )).rows[0].rep

    const staffCInB = reportTenantB.staff.find((s) => s.staff_id === ids.staffC)
    assert.ok(staffCInB, 'Staff C exists in Tenant B')
    assert.equal(staffCInB.articles_completed, 1, 'Staff C has only its own legacy completed')
    assert.equal(reportTenantB.staff.find((s) => s.staff_id === ids.staffA), undefined, 'Tenant A staff not leaked to B')

    // TEST 7: MyNewsWork: list_my_editorial_articles returns expected shape for Staff A
    const myEditorialWork = (await as(
      'authenticated',
      ids.staffA,
      'SELECT * FROM ap.list_my_editorial_articles()',
    )).rows

    assert.equal(myEditorialWork.length, 1)
    const edItem = myEditorialWork[0]
    assert.equal(edItem.article_id, articleId)
    assert.equal(edItem.news_backlog_id, ids.backlogA1)
    assert.equal(edItem.status, 'content_final')
    assert.equal(edItem.responsible_user_id, ids.staffA)
    assert.equal(edItem.headline, 'Manchete Editorial Rev2')
    assert.equal(edItem.origem_editorial, 'editorial')
    assert.ok(edItem.updated_at)
    assert.ok(edItem.first_finalized_at)

    // Staff B has no editorial articles
    const staffBEditorial = (await as('authenticated', ids.staffB, 'SELECT * FROM ap.list_my_editorial_articles()')).rows
    assert.equal(staffBEditorial.length, 0, 'Staff B sees 0 editorial articles')

    // Staff C (Tenant B) has flag OFF and returns 0 articles
    const staffCEditorial = (await as('authenticated', ids.staffC, 'SELECT * FROM ap.list_my_editorial_articles()')).rows
    assert.equal(staffCEditorial.length, 0, 'Tenant B with flag OFF returns 0')

    // Calling with cross-tenant client id throws FORBIDDEN
    await assert.rejects(
      as('authenticated', ids.staffA, 'SELECT * FROM ap.list_my_editorial_articles($1)', [ids.clientB]),
      /FORBIDDEN/,
    )

    // TEST 8: Flag OFF preserves legacy flow
    await as('authenticated', ids.adminA, 'SELECT ap.set_editorial_workflow_v1_enabled(false)')
    const staffAEditorialDisabled = (await as('authenticated', ids.staffA, 'SELECT * FROM ap.list_my_editorial_articles()')).rows
    assert.equal(staffAEditorialDisabled.length, 0, 'When flag is OFF, list_my_editorial_articles returns empty')

    // TEST 9: Nenhum candidate_news alterado
    const candidateCount = (await client.query('SELECT count(*)::int AS count FROM ap.candidate_news')).rows[0].count
    assert.equal(candidateCount, 0, 'No candidate_news rows created, modified, or deleted')
  } finally {
    if (client) await client.end()
    await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`)
    await admin.end()
  }
})
