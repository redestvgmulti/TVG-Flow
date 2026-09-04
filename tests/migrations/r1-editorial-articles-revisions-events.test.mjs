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
  assert.ok(name, `migration ${suffix} must exist`)
  return readFile(path.join(migrationsDir, name), 'utf8')
}

const migrationOne = await readMigration('_r1_editorial_feature_flags.sql')
const migrationTwo = await readMigration('_r1_editorial_articles_revisions_events.sql')
const operationalResolver = await readFile(
  path.join(migrationsDir, '20260817160000_add_fail_closed_operational_cliente_resolver.sql'),
  'utf8',
)
const operationalResolverAcl = await readFile(
  path.join(migrationsDir, '20260817160500_revoke_service_role_from_operational_cliente_resolver.sql'),
  'utf8',
)
const runtimeEnabled = process.env.RUN_LOCAL_R1_EDITORIAL_DOMAIN_SQL === '1'
const connection = {
  host: process.env.LOCAL_PG_HOST || '127.0.0.1',
  port: Number(process.env.LOCAL_PG_PORT || 54322),
  user: process.env.LOCAL_PG_USER || 'postgres',
  password: process.env.LOCAL_PG_PASSWORD || 'postgres',
  database: process.env.LOCAL_PG_DATABASE || 'postgres',
}

test('R1 editorial domain is private, append-only where required and candidate-free', () => {
  for (const table of [
    'editorial_articles',
    'editorial_article_revisions',
    'editorial_article_events',
  ]) {
    assert.match(migrationTwo, new RegExp(`ALTER TABLE ap\\.${table} ENABLE ROW LEVEL SECURITY;`))
    assert.match(migrationTwo, new RegExp(`ALTER TABLE ap\\.${table} FORCE ROW LEVEL SECURITY;`))
    for (const role of ['PUBLIC', 'anon', 'authenticated', 'service_role']) {
      assert.match(migrationTwo, new RegExp(`REVOKE ALL ON TABLE ap\\.${table} FROM ${role};`))
    }
  }
  assert.match(migrationTwo, /news_backlog_id uuid NOT NULL UNIQUE/)
  assert.match(migrationTwo, /FOREIGN KEY \(news_backlog_id, cliente_id\)\s+REFERENCES ap\.news_backlog\(id, cliente_id\)/)
  assert.match(migrationTwo, /status IN \('draft', 'editing', 'content_final', 'abandoned'\)/)
  assert.match(migrationTwo, /UNIQUE \(article_id, revision_number\)/)
  assert.match(migrationTwo, /draft_checkpoint', 'content_final/)
  assert.match(migrationTwo, /article_created',[\s\S]*article_reactivated'/)
  assert.match(migrationTwo, /BEFORE UPDATE OR DELETE ON ap\.editorial_article_revisions/)
  assert.match(migrationTwo, /BEFORE UPDATE OR DELETE ON ap\.editorial_article_events/)
  assert.doesNotMatch(migrationTwo, /candidate_news|render_generations|placid|instagram|ap\.system_config/i)
})

test('R1 editorial domain migration changes only the required backlog key outside new tables', () => {
  const legacyMutations = migrationTwo.match(/(?:ALTER|UPDATE|INSERT INTO|DELETE FROM)\s+ap\.(?!editorial_article|news_backlog)/gi) || []
  assert.deepEqual(legacyMutations, [])
  assert.match(migrationTwo, /ALTER TABLE ap\.news_backlog\s+ADD CONSTRAINT news_backlog_id_cliente_id_key UNIQUE \(id, cliente_id\)/)
})

test('R1 editorial domain runtime applies after Migration 1 and enforces database boundaries', {
  skip: !runtimeEnabled,
}, async () => {
  const databaseName = `tvg_r1_domain_${randomUUID().replaceAll('-', '')}`
  const admin = new pg.Client(connection)
  let client
  const ids = {
    admin: '11111111-1111-4111-8111-111111111111',
    staff: '22222222-2222-4222-8222-222222222222',
    clientA: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    clientB: 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',
    clientMissing: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    backlogA: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    articleA: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    articleDuplicate: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    requestOne: '99999999-9999-4999-8999-999999999999',
  }
  await admin.connect()

  try {
    const roles = await admin.query(
      "SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role')",
    )
    assert.equal(roles.rowCount, 3, 'the runtime test requires local Supabase roles')
    await admin.query(`CREATE DATABASE \"${databaseName}\"`)
    client = new pg.Client({ ...connection, database: databaseName })
    await client.connect()
    await client.query(`
      CREATE EXTENSION IF NOT EXISTS pgcrypto;
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
      CREATE TABLE ap.news_backlog (
        id uuid PRIMARY KEY,
        cliente_id uuid NOT NULL REFERENCES public.clientes(id)
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
    `)
    await client.query(operationalResolver)
    await client.query(operationalResolverAcl)
    await client.query(migrationOne)
    await client.query(migrationTwo)
    await client.query(
      "INSERT INTO public.profissionais (id, role, ativo) VALUES ($1, 'admin', true), ($2, 'staff', true)",
      [ids.admin, ids.staff],
    )
    await client.query('INSERT INTO public.clientes (id) VALUES ($1), ($2)', [ids.clientA, ids.clientB])
    await client.query('INSERT INTO ap.news_backlog (id, cliente_id) VALUES ($1, $2)', [ids.backlogA, ids.clientA])

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

    const rls = await client.query(`
      SELECT relname, relrowsecurity, relforcerowsecurity
        FROM pg_class
       WHERE relname IN ('editorial_articles', 'editorial_article_revisions', 'editorial_article_events')
       ORDER BY relname
    `)
    assert.deepEqual(rls.rows, [
      { relname: 'editorial_article_events', relrowsecurity: true, relforcerowsecurity: true },
      { relname: 'editorial_article_revisions', relrowsecurity: true, relforcerowsecurity: true },
      { relname: 'editorial_articles', relrowsecurity: true, relforcerowsecurity: true },
    ])
    const directPrivileges = await client.query(`
      SELECT relname,
        has_table_privilege('anon', oid, 'SELECT,INSERT,UPDATE,DELETE') AS anon_crud,
        has_table_privilege('authenticated', oid, 'SELECT,INSERT,UPDATE,DELETE') AS authenticated_crud
      FROM pg_class
      WHERE relname IN ('editorial_articles', 'editorial_article_revisions', 'editorial_article_events')
      ORDER BY relname
    `)
    assert.deepEqual(directPrivileges.rows, rls.rows.map(({ relname }) => ({
      relname,
      anon_crud: false,
      authenticated_crud: false,
    })))
    await assert.rejects(
      as('anon', null, 'SELECT * FROM ap.editorial_articles'),
      /permission denied/i,
    )
    await assert.rejects(
      as('authenticated', ids.staff, 'SELECT * FROM ap.editorial_articles'),
      /permission denied/i,
    )

    await assert.rejects(
      client.query(
        `INSERT INTO ap.editorial_articles
          (id, cliente_id, news_backlog_id, responsible_user_id, responsible_name_snapshot)
         VALUES ($1, $2, $3, $4, 'Admin')`,
        [ids.articleDuplicate, ids.clientMissing, ids.backlogA, ids.admin],
      ),
      /foreign key/i,
    )
    await assert.rejects(
      client.query(
        `INSERT INTO ap.editorial_articles
          (id, cliente_id, news_backlog_id, responsible_user_id, responsible_name_snapshot)
         VALUES ($1, $2, $3, $4, 'Admin')`,
        [ids.articleDuplicate, ids.clientB, ids.backlogA, ids.admin],
      ),
      /foreign key/i,
    )
    await assert.rejects(
      client.query(
        `INSERT INTO ap.editorial_articles
          (id, cliente_id, news_backlog_id, status, responsible_user_id, responsible_name_snapshot)
         VALUES ($1, $2, $3, 'rendering', $4, 'Admin')`,
        [ids.articleDuplicate, ids.clientA, ids.backlogA, ids.admin],
      ),
      /check constraint/i,
    )
    await client.query(
      `INSERT INTO ap.editorial_articles
        (id, cliente_id, news_backlog_id, responsible_user_id, responsible_name_snapshot)
       VALUES ($1, $2, $3, $4, 'Admin')`,
      [ids.articleA, ids.clientA, ids.backlogA, ids.admin],
    )
    await assert.rejects(
      client.query(
        `INSERT INTO ap.editorial_articles
          (id, cliente_id, news_backlog_id, responsible_user_id, responsible_name_snapshot)
         VALUES ($1, $2, $3, $4, 'Admin')`,
        [ids.articleDuplicate, ids.clientA, ids.backlogA, ids.admin],
      ),
      /duplicate key/i,
    )
    await client.query(
      `INSERT INTO ap.editorial_article_revisions
        (article_id, revision_number, revision_kind, headline, body, created_by_user_id, created_by_name_snapshot, request_id)
       VALUES ($1, 1, 'draft_checkpoint', 'Headline', 'Body', $2, 'Admin', $3)`,
      [ids.articleA, ids.admin, ids.requestOne],
    )
    await assert.rejects(
      client.query(
        `INSERT INTO ap.editorial_article_revisions
          (article_id, revision_number, revision_kind, headline, body, created_by_user_id, created_by_name_snapshot)
         VALUES ($1, 1, 'draft_checkpoint', 'Duplicate', 'Body', $2, 'Admin')`,
        [ids.articleA, ids.admin],
      ),
      /duplicate key/i,
    )
    await assert.rejects(
      client.query(
        `INSERT INTO ap.editorial_article_revisions
          (article_id, revision_number, revision_kind, headline, body, created_by_user_id, created_by_name_snapshot, request_id)
         VALUES ($1, 2, 'content_final', 'Final', 'Body', $2, 'Admin', $3)`,
        [ids.articleA, ids.admin, ids.requestOne],
      ),
      /duplicate key/i,
    )
    await assert.rejects(
      client.query('UPDATE ap.editorial_article_revisions SET headline = $1', ['Changed']),
      /EDITORIAL_APPEND_ONLY_RECORD/,
    )
    const event = await client.query(
      `INSERT INTO ap.editorial_article_events
        (article_id, cliente_id, actor_user_id, actor_kind, action, metadata, request_id)
       VALUES ($1, $2, $3, 'user', 'article_created', '{}'::jsonb, $4)
       RETURNING id`,
      [ids.articleA, ids.clientA, ids.admin, ids.requestOne],
    )
    await assert.rejects(
      as('authenticated', ids.staff, 'UPDATE ap.editorial_article_events SET metadata = $1 WHERE id = $2', ['{}', event.rows[0].id]),
      /permission denied/i,
    )
    await assert.rejects(
      as('authenticated', ids.staff, 'DELETE FROM ap.editorial_article_events WHERE id = $1', [event.rows[0].id]),
      /permission denied/i,
    )
    await assert.rejects(
      client.query('DELETE FROM ap.editorial_article_events WHERE id = $1', [event.rows[0].id]),
      /EDITORIAL_APPEND_ONLY_RECORD/,
    )
    const candidateDependencies = await client.query(`
      SELECT count(*)::integer AS count
        FROM pg_constraint AS constraint_row
        JOIN pg_class AS relation ON relation.oid = constraint_row.conrelid
       WHERE relation.relname IN ('editorial_articles', 'editorial_article_revisions', 'editorial_article_events')
         AND pg_get_constraintdef(constraint_row.oid) ILIKE '%candidate_news%'
    `)
    assert.equal(candidateDependencies.rows[0].count, 0)
  } finally {
    if (client) await client.end().catch(() => {})
    await admin.query(`DROP DATABASE IF EXISTS \"${databaseName}\" WITH (FORCE)`).catch(() => {})
    await admin.end()
  }
})
