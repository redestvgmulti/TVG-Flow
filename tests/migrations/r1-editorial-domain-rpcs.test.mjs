import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const migrationsDir = path.join(root, 'supabase', 'migrations')
const names = await readdir(migrationsDir)
const migration = await readFile(
  path.join(migrationsDir, names.find((name) => name.endsWith('_r1_editorial_domain_rpcs.sql'))),
  'utf8',
)
const migrationOne = await readFile(
  path.join(migrationsDir, names.find((name) => name.endsWith('_r1_editorial_feature_flags.sql'))),
  'utf8',
)
const migrationTwo = await readFile(
  path.join(migrationsDir, names.find((name) => name.endsWith('_r1_editorial_articles_revisions_events.sql'))),
  'utf8',
)
const resolver = await readFile(
  path.join(migrationsDir, '20260817160000_add_fail_closed_operational_cliente_resolver.sql'),
  'utf8',
)
const resolverAcl = await readFile(
  path.join(migrationsDir, '20260817160500_revoke_service_role_from_operational_cliente_resolver.sql'),
  'utf8',
)
const runtimeEnabled = process.env.RUN_LOCAL_R1_EDITORIAL_RPC_SQL === '1'
const connection = {
  host: process.env.LOCAL_PG_HOST || '127.0.0.1',
  port: Number(process.env.LOCAL_PG_PORT || 54322),
  user: process.env.LOCAL_PG_USER || 'postgres',
  password: process.env.LOCAL_PG_PASSWORD || 'postgres',
  database: process.env.LOCAL_PG_DATABASE || 'postgres',
}

test('R1 editorial RPC migration is tenant-derived, RPC-only and candidate mutation-free', () => {
  for (const name of [
    'start_editorial_article_from_backlog',
    'save_editorial_article_draft',
    'finalize_editorial_article',
    'reopen_editorial_article',
    'abandon_editorial_article',
    'get_editorial_article',
    'list_my_editorial_articles',
    'list_editorial_article_events',
  ]) {
    assert.match(migration, new RegExp(`CREATE FUNCTION ap\\.${name}`))
  }
  assert.match(migration, /SECURITY DEFINER[\s\S]*SET search_path = ''/)
  assert.match(migration, /public\.require_single_operational_cliente_id\(\)/)
  assert.match(migration, /EDITORIAL_WORKFLOW_DISABLED/)
  assert.match(migration, /FOR UPDATE/)
  assert.match(migration, /news_backlog_id/)
  assert.match(migration, /ON CONFLICT \(article_id, action, request_id\)/)
  assert.match(migration, /status = 'in_production'/)
  assert.match(migration, /status = 'available'/)
  assert.doesNotMatch(migration, /(?:INSERT INTO|UPDATE|DELETE FROM)\s+ap\.candidate_news/i)
  assert.match(migration, /CREATE FUNCTION ap\.start_editorial_article_from_backlog\(\s*p_backlog_id uuid,\s*p_request_id uuid\s*\)/)
  assert.match(migration, /CREATE FUNCTION ap\.save_editorial_article_draft\(\s*p_article_id uuid,\s*p_headline text,\s*p_body text,\s*p_request_id uuid\s*\)/)
  assert.match(migration, /CREATE FUNCTION ap\.finalize_editorial_article\(\s*p_article_id uuid,\s*p_headline text,\s*p_body text,\s*p_request_id uuid\s*\)/)
})

test('R1 editorial RPC migration exposes only authenticated execution', () => {
  assert.match(migration, /GRANT EXECUTE ON FUNCTION ap\.start_editorial_article_from_backlog\(uuid, uuid\) TO authenticated/)
  assert.match(migration, /REVOKE ALL ON FUNCTION ap\.start_editorial_article_from_backlog\(uuid, uuid\) FROM PUBLIC, anon, service_role/)
  assert.match(migration, /REVOKE ALL ON FUNCTION ap\.assert_editorial_workflow_v1_enabled\(uuid\) FROM PUBLIC, anon, authenticated, service_role/)
})

test('R1 editorial RPC runtime is transactional, idempotent and tenant-isolated', { skip: !runtimeEnabled }, async () => {
  const databaseName = `tvg_r1_rpcs_${randomUUID().replaceAll('-', '')}`
  const admin = new pg.Client(connection)
  let client
  const ids = {
    adminA: '11111111-1111-4111-8111-111111111111',
    staffA: '22222222-2222-4222-8222-222222222222',
    staffB: '33333333-3333-4333-8333-333333333333',
    noTenant: '44444444-4444-4444-8444-444444444444',
    multi: '55555555-5555-4555-8555-555555555555',
    superAdmin: '66666666-6666-4666-8666-666666666666',
    clientA: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    clientB: 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',
    backlogA: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    backlogOtherOwner: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    backlogLegacy: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    backlogB: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    legacyCandidate: '99999999-9999-4999-8999-999999999999',
  }
  const request = () => randomUUID()
  await admin.connect()
  try {
    const roles = await admin.query("SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role')")
    assert.equal(roles.rowCount, 3, 'local Supabase roles are required')
    await admin.query(`CREATE DATABASE "${databaseName}"`)
    client = new pg.Client({ ...connection, database: databaseName })
    await client.connect()
    await client.query(`
      CREATE EXTENSION IF NOT EXISTS pgcrypto;
      CREATE SCHEMA auth; CREATE SCHEMA ap;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS 'SELECT NULLIF(current_setting(''request.jwt.claim.sub'', true), '''')::uuid';
      CREATE TABLE public.profissionais (id uuid PRIMARY KEY, role text NOT NULL, ativo boolean NOT NULL, nome text NOT NULL DEFAULT 'Test actor');
      CREATE TABLE public.clientes (id uuid PRIMARY KEY, ativo boolean NOT NULL DEFAULT true);
      CREATE TABLE public.operational_clients (profissional_id uuid NOT NULL, cliente_id uuid NOT NULL);
      CREATE TABLE ap.news_backlog (
        id uuid PRIMARY KEY, cliente_id uuid NOT NULL REFERENCES public.clientes(id), status text NOT NULL,
        adopted_by_user_id uuid REFERENCES public.profissionais(id), adopted_by_name_snapshot text, adopted_at timestamptz,
        released_by_user_id uuid REFERENCES public.profissionais(id), released_at timestamptz,
        candidate_news_id uuid, production_started_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT backlog_consistency CHECK ((status = 'available' AND adopted_by_user_id IS NULL AND adopted_at IS NULL) OR (status IN ('adopted', 'in_production', 'completed') AND adopted_by_user_id IS NOT NULL AND adopted_at IS NOT NULL) OR status = 'archived')
      );
      CREATE TABLE ap.news_backlog_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), backlog_id uuid NOT NULL, cliente_id uuid NOT NULL,
        actor_user_id uuid NOT NULL, action text NOT NULL CHECK (action IN ('created', 'adopted', 'released', 'production_started')),
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE FUNCTION ap.get_operational_cliente_ids() RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, ap AS 'SELECT cliente_id FROM public.operational_clients WHERE profissional_id = auth.uid()';
      CREATE FUNCTION ap.require_editorial_admin_access(p_cliente_id uuid) RETURNS TABLE (user_id uuid, role text, display_name text)
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
      BEGIN
        RETURN QUERY SELECT p.id, p.role, p.nome FROM public.profissionais p
        WHERE p.id = auth.uid() AND p.ativo AND p.role IN ('admin', 'super_admin')
          AND EXISTS (SELECT 1 FROM public.operational_clients m WHERE m.profissional_id = p.id AND m.cliente_id = p_cliente_id);
        IF NOT FOUND THEN RAISE EXCEPTION 'EDITORIAL_ADMIN_REQUIRED' USING ERRCODE = '42501'; END IF;
      END; $$;
      GRANT USAGE ON SCHEMA auth, ap, public TO anon, authenticated, service_role;
    `)
    await client.query(resolver); await client.query(resolverAcl)
    await client.query(migrationOne); await client.query(migrationTwo); await client.query(migration)
    await client.query(`
      INSERT INTO public.profissionais (id, role, ativo, nome) VALUES
        ('${ids.adminA}', 'admin', true, 'Admin A'), ('${ids.staffA}', 'staff', true, 'Staff A'),
        ('${ids.staffB}', 'staff', true, 'Staff B'), ('${ids.noTenant}', 'staff', true, 'No Tenant'),
        ('${ids.multi}', 'staff', true, 'Multi Tenant'), ('${ids.superAdmin}', 'super_admin', true, 'Super Admin');
      INSERT INTO public.clientes (id) VALUES ('${ids.clientA}'), ('${ids.clientB}');
      INSERT INTO public.operational_clients VALUES
        ('${ids.adminA}', '${ids.clientA}'), ('${ids.staffA}', '${ids.clientA}'), ('${ids.staffB}', '${ids.clientA}'),
        ('${ids.multi}', '${ids.clientA}'), ('${ids.multi}', '${ids.clientB}');
      INSERT INTO ap.news_backlog (id, cliente_id, status, adopted_by_user_id, adopted_by_name_snapshot, adopted_at, candidate_news_id) VALUES
        ('${ids.backlogA}', '${ids.clientA}', 'adopted', '${ids.staffA}', 'Staff A', now(), NULL),
        ('${ids.backlogOtherOwner}', '${ids.clientA}', 'adopted', '${ids.staffB}', 'Staff B', now(), NULL),
        ('${ids.backlogLegacy}', '${ids.clientA}', 'adopted', '${ids.staffA}', 'Staff A', now(), '${ids.legacyCandidate}'),
        ('${ids.backlogB}', '${ids.clientB}', 'adopted', '${ids.staffA}', 'Staff A', now(), NULL);
    `)
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
    const callStart = (role, userId, backlogId, requestId) => as(role, userId, 'SELECT (ap.start_editorial_article_from_backlog($1, $2)).id AS id', [backlogId, requestId])
    const callArticle = (role, userId, fn, articleId, headline, body, requestId) => as(role, userId, `SELECT (ap.${fn}($1, $2, $3, $4)).id AS id`, [articleId, headline, body, requestId])

    await assert.rejects(callStart('authenticated', ids.staffA, ids.backlogA, request()), /EDITORIAL_WORKFLOW_DISABLED/)
    await as('authenticated', ids.adminA, 'SELECT ap.set_editorial_workflow_v1_enabled(true)')
    await assert.rejects(callStart('authenticated', ids.noTenant, ids.backlogA, request()), /OPERATIONAL_CLIENT_NOT_FOUND/)
    await assert.rejects(callStart('authenticated', ids.multi, ids.backlogA, request()), /OPERATIONAL_CLIENT_SELECTION_REQUIRED/)
    await assert.rejects(callStart('authenticated', ids.superAdmin, ids.backlogA, request()), /OPERATIONAL_CLIENT_SELECTION_REQUIRED/)
    await assert.rejects(callStart('authenticated', ids.staffA, ids.backlogOtherOwner, request()), /BACKLOG_NOT_OWNED/)
    await assert.rejects(callStart('authenticated', ids.staffA, ids.backlogB, request()), /BACKLOG_NOT_FOUND/)
    await assert.rejects(callStart('authenticated', ids.staffA, ids.backlogLegacy, request()), /BACKLOG_LEGACY_CANDIDATE_LINKED/)

    const startRequest = request()
    const started = await callStart('authenticated', ids.staffA, ids.backlogA, startRequest)
    const articleId = started.rows[0].id
    assert.ok(articleId)
    const secondClick = await callStart('authenticated', ids.staffA, ids.backlogA, request())
    assert.equal(secondClick.rows[0].id, articleId)
    assert.equal((await client.query('SELECT count(*)::int AS count FROM ap.editorial_articles WHERE news_backlog_id = $1', [ids.backlogA])).rows[0].count, 1)
    assert.equal((await client.query('SELECT status FROM ap.news_backlog WHERE id = $1', [ids.backlogA])).rows[0].status, 'in_production')
    assert.equal((await client.query("SELECT count(*)::int AS count FROM ap.news_backlog WHERE id = $1 AND status = 'available'", [ids.backlogA])).rows[0].count, 0)

    const draftRequest = request()
    await callArticle('authenticated', ids.staffA, 'save_editorial_article_draft', articleId, 'Draft', 'Draft body', draftRequest)
    await callArticle('authenticated', ids.staffA, 'save_editorial_article_draft', articleId, 'Changed', 'Changed body', draftRequest)
    assert.equal((await client.query("SELECT count(*)::int AS count FROM ap.editorial_article_revisions WHERE article_id = $1 AND revision_kind = 'draft_checkpoint'", [articleId])).rows[0].count, 1)
    await assert.rejects(callArticle('authenticated', ids.staffB, 'save_editorial_article_draft', articleId, 'No', 'No', request()), /FORBIDDEN/)
    await callArticle('authenticated', ids.adminA, 'save_editorial_article_draft', articleId, 'Admin draft', 'Admin body', request())

    const finalizeRequest = request()
    await callArticle('authenticated', ids.staffA, 'finalize_editorial_article', articleId, 'Final', 'Final body', finalizeRequest)
    await callArticle('authenticated', ids.staffA, 'finalize_editorial_article', articleId, 'Final changed', 'Final changed', finalizeRequest)
    assert.equal((await client.query("SELECT count(*)::int AS count FROM ap.editorial_article_revisions WHERE article_id = $1 AND revision_kind = 'content_final'", [articleId])).rows[0].count, 1)
    const finalized = await client.query('SELECT status, first_finalized_at, author_user_id FROM ap.editorial_articles WHERE id = $1', [articleId])
    assert.equal(finalized.rows[0].status, 'content_final'); assert.ok(finalized.rows[0].first_finalized_at); assert.equal(finalized.rows[0].author_user_id, ids.staffA)
    assert.equal((await as('authenticated', ids.staffA, 'SELECT (ap.get_editorial_article($1)).id AS id', [articleId])).rows[0].id, articleId)
    assert.equal((await as('authenticated', ids.staffA, 'SELECT count(*)::int AS count FROM ap.list_my_editorial_articles()')).rows[0].count, 1)
    assert.ok((await as('authenticated', ids.staffA, 'SELECT count(*)::int AS count FROM ap.list_editorial_article_events($1)', [articleId])).rows[0].count >= 3)
    await assert.rejects(as('authenticated', ids.staffB, 'SELECT (ap.get_editorial_article($1)).id', [articleId]), /FORBIDDEN/)
    assert.equal((await as('authenticated', ids.adminA, 'SELECT (ap.get_editorial_article($1)).id AS id', [articleId])).rows[0].id, articleId)

    await as('authenticated', ids.staffA, 'SELECT (ap.reopen_editorial_article($1, $2, $3)).id', [articleId, 'Correction', request()])
    assert.equal((await client.query("SELECT count(*)::int AS count FROM ap.editorial_article_revisions WHERE article_id = $1 AND revision_kind = 'content_final'", [articleId])).rows[0].count, 1)
    await as('authenticated', ids.staffA, 'SELECT (ap.abandon_editorial_article($1, $2, $3)).id', [articleId, 'No longer needed', request()])
    const abandoned = await client.query('SELECT a.status AS article_status, b.status AS backlog_status, b.adopted_by_user_id FROM ap.editorial_articles a JOIN ap.news_backlog b ON b.id = a.news_backlog_id WHERE a.id = $1', [articleId])
    assert.deepEqual(abandoned.rows[0], { article_status: 'abandoned', backlog_status: 'available', adopted_by_user_id: null })
    await client.query("UPDATE ap.news_backlog SET status = 'adopted', adopted_by_user_id = $2, adopted_by_name_snapshot = 'Staff A', adopted_at = now() WHERE id = $1", [ids.backlogA, ids.staffA])
    const reactivated = await callStart('authenticated', ids.staffA, ids.backlogA, request())
    assert.equal(reactivated.rows[0].id, articleId)
    assert.equal((await client.query('SELECT count(*)::int AS count FROM ap.editorial_articles WHERE news_backlog_id = $1', [ids.backlogA])).rows[0].count, 1)

    await assert.rejects(as('authenticated', ids.staffA, 'UPDATE ap.editorial_article_events SET metadata = $1 WHERE article_id = $2', [{ bad: true }, articleId]), /permission denied|EDITORIAL_APPEND_ONLY_RECORD/i)
    assert.equal((await client.query('SELECT candidate_news_id FROM ap.news_backlog WHERE id = $1', [ids.backlogLegacy])).rows[0].candidate_news_id, ids.legacyCandidate)
  } finally {
    if (client) await client.end()
    await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`)
    await admin.end()
  }
})
