// Shared fixture for the 2B.1 test suite: base schema stubs (auth, tenancy,
// resolver) + the full migration chain (R1 -> P0 -> 2B.1) applied in order
// against a fresh, isolated database. Reused by every 2b1-*.test.mjs runtime
// test so the ~250 lines of setup SQL are not duplicated six times.
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const migrationsDir = path.join(root, 'supabase', 'migrations')

export const connection = {
  host: process.env.LOCAL_PG_HOST || '127.0.0.1',
  port: Number(process.env.LOCAL_PG_PORT || 55322),
  user: process.env.LOCAL_PG_USER || 'postgres',
  password: process.env.LOCAL_PG_PASSWORD || 'postgres',
  database: process.env.LOCAL_PG_DATABASE || 'postgres',
}

export const runtimeEnabled = Boolean(process.env.LOCAL_PG_PORT) || process.env.RUN_LOCAL_2B1_SQL === '1'

async function readMigration(suffix) {
  const names = await (await import('node:fs/promises')).readdir(migrationsDir)
  const name = names.find((candidate) => candidate.endsWith(suffix))
  if (!name) throw new Error(`migration ending with ${suffix} must exist`)
  return readFile(path.join(migrationsDir, name), 'utf8')
}

const BASE_SQL = `
  CREATE EXTENSION IF NOT EXISTS pgcrypto;
  DO $$ BEGIN
    IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
    IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
    IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
  END $$;

  CREATE SCHEMA auth;
  CREATE SCHEMA ap;
  GRANT USAGE ON SCHEMA auth, ap, public TO anon, authenticated, service_role;

  -- Matches Supabase's real convention: one JSON blob (request.jwt.claims),
  -- not a per-field GUC. Compatible with every RPC touched by this suite,
  -- across R1 (auth.uid() only) and P0 (auth.jwt()->>'role' + auth.uid()).
  CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
    SELECT COALESCE(NULLIF(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
  $$;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
    SELECT NULLIF(auth.jwt()->>'sub', '')::uuid
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

  -- Real shape from tests/p0/fixture.sql, proven against the P0 migration.
  CREATE TABLE ap.candidate_news (
    id uuid PRIMARY KEY, cliente_id uuid REFERENCES public.clientes, status text NOT NULL,
    titulo text,conteudo text,headline text,caption text,url_original text,source text,
    imagem_url text,imagem_storage text,image_external boolean,context_tag text,categoria text,visual_title_id uuid,
    content_type text,template_id uuid,template_ordem integer,template_set text,placid_template_uuid text,template_nome_snapshot text,
    render_contract_version text,render_snapshot jsonb,sponsor_count smallint,patrocinador_id uuid,territorial_reservation_id uuid,
    roteiro_json jsonb,roteiro_studio text,duracao_estimada integer,broll_sugestao text,studio_media_image_url text,studio_media_video_url text,
    visual_energy_level text,has_face boolean,render_url text,instagram_post_id text,horario_agendado timestamptz,
    render_started_at timestamptz,render_completed_at timestamptz,completed_at timestamptz,processing_started_at timestamptz,
    criado_por_user_id uuid,
    approved_by uuid,approved_by_name text,approved_at timestamptz,published_at timestamptz,worker_id uuid,
    error_log text,render_attempts integer DEFAULT 0,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),
    CONSTRAINT candidate_news_status_check CHECK(status IN ('raw','processing','ready_for_scoring','scored','selected','pending_render','pending_review','approved','queued_for_posting','posted','rejected','failed'))
  );
  CREATE TABLE ap.territorial_sponsor_reservations(
    id uuid PRIMARY KEY,status text,committed_at timestamptz,reserved_at timestamptz,released_at timestamptz,release_reason text
  );
  -- The real project grants the service worker (and RLS-scoped authenticated
  -- reads) broad table access; BYPASSRLS alone does not imply table-level
  -- GRANTs. This mirrors tests/p0/fixture.sql's own grant.
  GRANT SELECT, INSERT, UPDATE ON ap.candidate_news TO authenticated, service_role;

  CREATE TABLE ap.news_backlog (
    id uuid PRIMARY KEY,
    cliente_id uuid NOT NULL REFERENCES public.clientes(id),
    status text NOT NULL,
    titulo text,
    url_original text,
    normalized_url text,
    observacao text,
    origem text NOT NULL DEFAULT 'manual_link',
    created_by_user_id uuid REFERENCES public.profissionais(id),
    created_by_name_snapshot text,
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
    actor_user_id uuid,
    action text NOT NULL,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
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
`

export async function createFixtureDatabase(namePrefix) {
  const databaseName = `${namePrefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`
  const admin = new pg.Client(connection)
  await admin.connect()
  await admin.query(`CREATE DATABASE "${databaseName}"`)
  await admin.end()

  const client = new pg.Client({ ...connection, database: databaseName })
  await client.connect()

  const operationalResolver = await readFile(
    path.join(migrationsDir, '20260817160000_add_fail_closed_operational_cliente_resolver.sql'), 'utf8')
  const operationalResolverAcl = await readFile(
    path.join(migrationsDir, '20260817160500_revoke_service_role_from_operational_cliente_resolver.sql'), 'utf8')
  const r1Flags = await readMigration('_r1_editorial_feature_flags.sql')
  const r1Articles = await readMigration('_r1_editorial_articles_revisions_events.sql')
  const r1Rpcs = await readMigration('_r1_editorial_domain_rpcs.sql')
  const p0 = await readMigration('_p0_editorial_publication_render_invariants.sql')
  const m1 = await readMigration('_2b1_editorial_origin_and_production_intent.sql')
  const m2 = await readMigration('_2b1_editorial_state_machine_expansion.sql')
  const m3 = await readMigration('_2b1_editorial_direct_origin_rpc.sql')
  const m4 = await readMigration('_2b1_editorial_production_intent_rpc.sql')
  const m5 = await readMigration('_2b1_editorial_review_and_freeze_rpcs.sql')
  const m6 = await readMigration('_2b1_editorial_render_handoff_rpcs.sql')
  const m7 = await readMigration('_2b1_backlog_editorial_exclusivity.sql')
  const m8 = await readMigration('_2b2_editorial_article_for_edit_rpc.sql')
  const m9 = await readMigration('_2b2_editorial_admin_tenant_visibility.sql')

  await client.query(BASE_SQL)
  await client.query(operationalResolver)
  await client.query(operationalResolverAcl)
  await client.query(r1Flags)
  await client.query(r1Articles)
  await client.query(r1Rpcs)
  // Migration 4 (reporting) is intentionally not applied: it only adds
  // get_staff_productivity_report/list_my_editorial_articles(p_cliente_id)
  // overloads unrelated to this suite's contract, and 2b1's migration 2
  // already recreates list_my_editorial_articles(p_cliente_id) with the
  // LEFT JOIN fix -- applying migration 4 first would create the function
  // this suite then immediately replaces, which is fine, but its own
  // reporting bridge (material_production_events) is out of scope here.
  await client.query(p0)
  await client.query(m1)
  await client.query(m2)
  await client.query(m3)
  await client.query(m4)
  await client.query(m5)
  await client.query(m6)
  await client.query(m7)
  await client.query(m8)
  await client.query(m9)

  return { admin, client, databaseName }
}

export async function dropFixtureDatabase({ client, databaseName }) {
  await client.end()
  const admin = new pg.Client(connection)
  await admin.connect()
  await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`)
  await admin.end()
}

// Runs `queryText` as `role`, with request.jwt.claims set to `claims`
// (an object; sub/role/app_role/cliente_id are the fields the RPCs read).
export async function as(client, role, claims, queryText, values = []) {
  await client.query(`SET ROLE ${role}`)
  try {
    await client.query("SELECT set_config('request.jwt.claims', $1, false)", [JSON.stringify(claims || {})])
    return await client.query(queryText, values)
  } finally {
    await client.query('RESET ROLE')
    await client.query("SELECT set_config('request.jwt.claims', '', false)")
  }
}
