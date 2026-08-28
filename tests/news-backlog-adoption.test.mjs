import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import pg from 'pg'

const { Client } = pg
const databaseUrl = process.env.TVG_BACKLOG_TEST_DATABASE_URL
const baselineMigrationUrl = new URL(
  '../supabase/migrations/20260817150000_create_shared_news_backlog.sql',
  import.meta.url,
)
const phaseMigrationUrl = new URL(
  '../supabase/migrations/20260823210000_evolve_shared_news_backlog_phase_1a.sql',
  import.meta.url,
)
const discardMigrationUrl = new URL(
  '../supabase/migrations/20260824000000_add_discard_news_backlog_item.sql',
  import.meta.url,
)

const tenantA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const tenantB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const userA = '11111111-1111-4111-8111-111111111111'
const userB = '22222222-2222-4222-8222-222222222222'
const userOtherTenant = '33333333-3333-4333-8333-333333333333'
const candidateId = '44444444-4444-4444-8444-444444444444'
const sourceUrl = 'https://example.com/pauta-controlada'
const trackedUrl = 'https://site.com/noticia/?utm_source=instagram#redes'
const cleanUrl = 'https://site.com/noticia'

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('baseline backlog remains isolated from candidate_news and uses database CAS', async () => {
  const migration = await source('supabase/migrations/20260817150000_create_shared_news_backlog.sql')
  assert.match(migration, /CREATE TABLE ap\.news_backlog/)
  assert.match(migration, /CREATE TABLE ap\.news_backlog_events/)
  assert.match(migration, /status IN \('available', 'adopted', 'archived'\)/)
  assert.match(migration, /UPDATE ap\.news_backlog AS backlog[\s\S]*status = 'adopted'/)
  assert.match(migration, /AND backlog\.status = 'available'/)
  assert.match(migration, /AND backlog\.adopted_by_user_id IS NULL/)
  assert.match(migration, /auth\.uid\(\)/)
  assert.match(migration, /REVOKE ALL ON TABLE ap\.news_backlog FROM PUBLIC, anon, authenticated/)
  assert.doesNotMatch(migration, /UPDATE\s+ap\.candidate_news/i)
  assert.doesNotMatch(migration, /DELETE\s+FROM\s+ap\.candidate_news/i)
  assert.doesNotMatch(migration, /ALTER TABLE\s+ap\.candidate_news/i)
})

test('phase 1A migration versions URL normalization, deduplicates per tenant and preserves authorization boundaries', async () => {
  const migration = await source('supabase/migrations/20260823210000_evolve_shared_news_backlog_phase_1a.sql')
  assert.match(migration, /shared_news_backlog_enabled boolean[\s\S]*DEFAULT false/)
  assert.match(migration, /CREATE OR REPLACE FUNCTION ap\.normalize_news_backlog_url/)
  assert.match(migration, /'utm_source', 'utm_medium', 'utm_campaign', 'utm_term'/)
  assert.match(migration, /'utm_content', 'fbclid', 'gclid'/)
  assert.match(migration, /url_normalization_version smallint NOT NULL DEFAULT 1/)
  assert.match(migration, /CREATE UNIQUE INDEX uq_news_backlog_cliente_normalized_url[\s\S]*cliente_id, normalized_url/)
  assert.match(migration, /ON CONFLICT \(cliente_id, normalized_url\) DO NOTHING/)
  assert.match(migration, /jsonb_build_object\([\s\S]*'created',[\s\S]*'item'/)
  assert.match(migration, /professional\.ativo IS TRUE/)
  assert.match(migration, /professional\.role IN \('admin', 'staff'\)/)
  assert.match(migration, /get_operational_cliente_ids/)
  assert.doesNotMatch(migration, /region_id|regiao_id|região/i)
  assert.match(migration, /'linked'/)
  assert.doesNotMatch(migration, /net\.http|ap-link-scraper|ap-image-fetcher|fetch\s*\(/i)
  assert.doesNotMatch(migration, /UPDATE\s+ap\.candidate_news/i)
  assert.doesNotMatch(migration, /ALTER TABLE\s+ap\.candidate_news/i)
})

test('discard migration archives safely and preserves the complete phase 1A list contract', async () => {
  const migration = await source('supabase/migrations/20260824000000_add_discard_news_backlog_item.sql')
  assert.match(migration, /CREATE OR REPLACE FUNCTION ap\.discard_news_backlog_item/)
  assert.match(migration, /require_news_backlog_access/)
  assert.match(migration, /backlog\.status = 'available'/)
  assert.match(migration, /backlog\.adopted_by_user_id = v_actor\.user_id/)
  assert.match(migration, /candidate_news_id IS NULL/)
  assert.match(migration, /GRANT EXECUTE ON FUNCTION ap\.discard_news_backlog_item\(uuid, uuid\) TO authenticated/)
  assert.match(migration, /'linked', 'discarded'/)
  assert.match(migration, /normalized_url text/)
  assert.match(migration, /url_normalization_version smallint/)
  assert.match(migration, /updated_at timestamptz/)
  assert.match(migration, /status <> 'archived'/)
})

test('news backlog compatibility endpoint now lists only available links from oldest to newest', async () => {
  const migration = await source('supabase/migrations/20260827172413_editorial_collection_work_and_productivity.sql')

  assert.match(migration, /CREATE OR REPLACE FUNCTION ap\.list_news_backlog\(p_cliente_id uuid\)/)
  assert.match(migration, /backlog\.status = 'available'/)
  assert.match(migration, /ORDER BY backlog\.created_at ASC, backlog\.id ASC/)
  assert.match(migration, /CREATE OR REPLACE FUNCTION ap\.list_my_news_work/)
  assert.match(migration, /backlog\.adopted_by_user_id = v_actor\.user_id/)
})

test('productive generator receives backlog_id only after user-bound authorization', async () => {
  const generator = await source('supabase/functions/ap-employee-generator/index.ts')
  assert.match(generator, /backlog_id: rawBacklogId = null/)
  assert.match(generator, /assert_news_backlog_production_access/)
  assert.match(generator, /link_news_backlog_candidate/)
  assert.match(generator, /BACKLOG_PRODUCTION_FORBIDDEN/)
  assert.match(generator, /BACKLOG_LINK_FAILED/)
})

test('link registration performs only the backlog RPC and adoption is the single creation action', async () => {
  const panel = await source('src/components/editorial/NewsBacklogPanel.jsx')
  const adminUi = await source('src/pages/admin/AutoPublisher.jsx')
  const employeeUi = await source('src/pages/admin/EmployeeMode.jsx')
  const myWork = await source('src/pages/staff/MyNewsWork.jsx')

  assert.match(panel, /create_news_backlog_item/)
  assert.match(panel, /p_url_original: inputUrl/)
  assert.match(panel, /p_titulo: title \|\| null/)
  assert.match(panel, /p_observacao: note \|\| null/)
  assert.match(panel, /adopt_news_backlog_item/)
  assert.match(panel, /onStartProduction\?\.\(adopted\)/)
  assert.match(panel, /Pegar matéria/)
  assert.match(panel, /Abrir link/)
  assert.match(panel, /POLL_INTERVAL_MS = 15_000/)
  assert.match(panel, /Esta matéria acabou de ser pega por/)
  assert.match(panel, /discard_news_backlog_item/)
  assert.match(panel, /const canManage = role === 'admin' \|\| role === 'super_admin'/)
  assert.match(myWork, /list_my_news_work/)
  assert.match(myWork, /release_news_backlog_item/)
  assert.doesNotMatch(panel, /Minhas pautas|Adotadas por outros|release_news_backlog_item/)
  assert.doesNotMatch(panel, /ap-link-scraper|ap-image-fetcher|ap-employee-generator|ap-render-engine|instagram|fetch\s*\(/i)

  assert.match(adminUi, /NewsBacklogPanel/)
  assert.match(adminUi, /url_original: item\.url_original/)
  assert.match(adminUi, /backlog_id: item\.id/)
  assert.match(employeeUi, /NewsBacklogPanel/)
  assert.match(employeeUi, /url_original: item\.url_original/)
  assert.match(employeeUi, /backlog_id: item\.id/)
  assert.match(
    employeeUi,
    /url_original:\s*formData\.backlog_id\s*\|\|\s*sourceMode\s*===\s*'link'\s*\?\s*url_original\s*:\s*null/,
  )
})

function connectionForRole(role, password) {
  const url = new URL(databaseUrl)
  url.username = role
  url.password = password
  return new Client({ connectionString: url.toString() })
}

async function asUser(client, userId) {
  await client.query("select set_config('request.jwt.claim.sub', $1, false)", [userId])
}

test('PostgreSQL contract covers creation, visibility, cross-region access, tenant isolation, dedupe, CAS and linking', {
  skip: !databaseUrl,
}, async () => {
  const admin = new Client({ connectionString: databaseUrl })
  let actorA
  let actorB
  let otherTenant
  let service
  await admin.connect()
  try {
    await admin.query(`
      create role anon noinherit;
      create role authenticated noinherit login password 'authenticated-test-only';
      create role service_role noinherit login password 'service-test-only';
      create schema auth;
      create function auth.uid() returns uuid language sql stable
        as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      create function auth.jwt() returns jsonb language sql stable
        as $$ select jsonb_build_object('role', session_user) $$;
      create schema ap;
      create table public.clientes (id uuid primary key);
      create table public.profissionais (
        id uuid primary key,
        nome text,
        role text,
        ativo boolean,
        regiao_operacional text
      );
      create table public.backlog_test_memberships (user_id uuid, cliente_id uuid);
      create table ap.system_config (
        cliente_id uuid primary key references public.clientes(id) on delete cascade,
        ingestion_enabled boolean not null default true,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );
      create table ap.candidate_news (
        id uuid primary key,
        cliente_id uuid not null references public.clientes(id),
        criado_por_user_id uuid,
        url_original text not null
      );
      create function ap.get_operational_cliente_ids() returns setof uuid language sql stable
        as $$ select cliente_id from public.backlog_test_memberships where user_id = auth.uid() $$;
      grant usage on schema ap to authenticated, service_role;
    `)
    await admin.query(await readFile(baselineMigrationUrl, 'utf8'))
    await admin.query(await readFile(phaseMigrationUrl, 'utf8'))
    await admin.query(await readFile(discardMigrationUrl, 'utf8'))
    await admin.query(
      'insert into public.clientes (id) values ($1), ($2)',
      [tenantA, tenantB],
    )
    await admin.query(
      `insert into ap.system_config (cliente_id, shared_news_backlog_enabled)
       values ($1, true), ($2, true)`,
      [tenantA, tenantB],
    )
    await admin.query(
      `insert into public.profissionais (id, nome, role, ativo, regiao_operacional) values
        ($1, 'Ana Sul', 'staff', true, 'sul'),
        ($2, 'Bruno Norte', 'staff', true, 'norte'),
        ($3, 'Carla Outro Tenant', 'staff', true, 'centro')`,
      [userA, userB, userOtherTenant],
    )
    await admin.query(
      'insert into public.backlog_test_memberships (user_id, cliente_id) values ($1, $2), ($3, $2), ($4, $5)',
      [userA, tenantA, userB, userOtherTenant, tenantB],
    )

    actorA = connectionForRole('authenticated', 'authenticated-test-only')
    actorB = connectionForRole('authenticated', 'authenticated-test-only')
    otherTenant = connectionForRole('authenticated', 'authenticated-test-only')
    service = connectionForRole('service_role', 'service-test-only')
    await Promise.all([actorA.connect(), actorB.connect(), otherTenant.connect(), service.connect()])
    await Promise.all([asUser(actorA, userA), asUser(actorB, userB), asUser(otherTenant, userOtherTenant)])

    const created = await actorA.query(
      'select ap.create_news_backlog_item($1, $2, $3, $4) as result',
      [tenantA, sourceUrl, null, null],
    )
    const createdResult = created.rows[0].result
    const backlogId = createdResult.item.id
    assert.equal(createdResult.created, true)
    assert.equal(createdResult.item.status, 'available')
    assert.equal(createdResult.item.created_by_user_id, userA)
    assert.equal(createdResult.item.url_original, sourceUrl)
    assert.equal(createdResult.item.normalized_url, sourceUrl)
    assert.equal(createdResult.item.url_normalization_version, 1)

    const crossRegionList = await actorB.query(
      'select * from ap.list_news_backlog($1)', [tenantA],
    )
    assert.equal(crossRegionList.rowCount, 1)
    assert.equal(crossRegionList.rows[0].id, backlogId)

    await assert.rejects(
      otherTenant.query('select * from ap.list_news_backlog($1)', [tenantA]),
      (error) => error?.code === '42501' && error?.message.includes('BACKLOG_TENANT_FORBIDDEN'),
    )
    await assert.rejects(
      otherTenant.query('select * from ap.adopt_news_backlog_item($1, $2)', [backlogId, tenantA]),
      (error) => error?.code === '42501',
    )

    const dedupeFirst = await actorA.query(
      'select ap.create_news_backlog_item($1, $2, null, null) as result',
      [tenantA, trackedUrl],
    )
    const dedupeSecond = await actorB.query(
      'select ap.create_news_backlog_item($1, $2, null, null) as result',
      [tenantA, cleanUrl],
    )
    assert.equal(dedupeFirst.rows[0].result.created, true)
    assert.equal(dedupeSecond.rows[0].result.created, false)
    assert.equal(dedupeSecond.rows[0].result.item.id, dedupeFirst.rows[0].result.item.id)
    assert.equal(dedupeFirst.rows[0].result.item.url_original, trackedUrl)
    assert.equal(dedupeFirst.rows[0].result.item.normalized_url, cleanUrl)
    const dedupeCount = await admin.query(
      'select count(*)::int as total from ap.news_backlog where cliente_id = $1 and normalized_url = $2',
      [tenantA, cleanUrl],
    )
    assert.equal(dedupeCount.rows[0].total, 1)
    const createdEventCount = await admin.query(
      "select count(*)::int as total from ap.news_backlog_events where backlog_id = $1 and action = 'created'",
      [dedupeFirst.rows[0].result.item.id],
    )
    assert.equal(createdEventCount.rows[0].total, 1)

    const sameUrlOtherTenant = await otherTenant.query(
      'select ap.create_news_backlog_item($1, $2, null, null) as result',
      [tenantB, cleanUrl],
    )
    assert.equal(sameUrlOtherTenant.rows[0].result.created, true)
    assert.notEqual(sameUrlOtherTenant.rows[0].result.item.id, dedupeFirst.rows[0].result.item.id)

    const crossRegionAdoption = await actorB.query(
      'select * from ap.adopt_news_backlog_item($1, $2)',
      [dedupeFirst.rows[0].result.item.id, tenantA],
    )
    assert.equal(crossRegionAdoption.rows[0].status, 'adopted')
    assert.equal(crossRegionAdoption.rows[0].adopted_by_user_id, userB)

    const normalizedFunctionalQuery = await admin.query(
      "select ap.normalize_news_backlog_url('HTTPS://Example.COM:443/noticia/?id=42&utm_medium=social&gclid=x#fragment') as value",
    )
    assert.equal(normalizedFunctionalQuery.rows[0].value, 'https://example.com/noticia?id=42')
    await assert.rejects(
      actorA.query('select ap.create_news_backlog_item($1, $2, null, null)', [tenantA, 'ftp://example.com/file']),
      (error) => error?.code === '22023' && error?.message.includes('BACKLOG_URL_INVALID'),
    )

    const beforeAdoption = Date.now()
    const adoption = (client) => client.query(
      'select * from ap.adopt_news_backlog_item($1, $2)', [backlogId, tenantA],
    )
    const race = await Promise.allSettled([adoption(actorA), adoption(actorB)])
    assert.equal(race.filter(result => result.status === 'fulfilled').length, 1)
    assert.equal(race.filter(result => result.status === 'rejected').length, 1)
    assert.equal(race.find(result => result.status === 'rejected').reason.code, 'P0001')

    const afterRace = await admin.query(
      'select status, adopted_by_user_id, adopted_by_name_snapshot, adopted_at from ap.news_backlog where id = $1',
      [backlogId],
    )
    assert.equal(afterRace.rows[0].status, 'adopted')
    assert.ok([userA, userB].includes(afterRace.rows[0].adopted_by_user_id))
    assert.ok(['Ana Sul', 'Bruno Norte'].includes(afterRace.rows[0].adopted_by_name_snapshot))
    assert.ok(new Date(afterRace.rows[0].adopted_at).getTime() >= beforeAdoption)
    const winner = afterRace.rows[0].adopted_by_user_id
    const winnerClient = winner === userA ? actorA : actorB
    const loserClient = winner === userA ? actorB : actorA

    await assert.rejects(
      loserClient.query('select * from ap.release_news_backlog_item($1, $2)', [backlogId, tenantA]),
      (error) => error?.code === '42501',
    )
    const released = await winnerClient.query(
      'select * from ap.release_news_backlog_item($1, $2)', [backlogId, tenantA],
    )
    assert.equal(released.rows[0].status, 'available')

    await actorA.query('select * from ap.adopt_news_backlog_item($1, $2)', [backlogId, tenantA])
    await assert.rejects(
      actorB.query('select * from ap.assert_news_backlog_production_access($1, $2, $3)', [backlogId, tenantA, sourceUrl]),
      (error) => error?.code === '42501',
    )
    const approvedStart = await actorA.query(
      'select (ap.assert_news_backlog_production_access($1, $2, $3)).*',
      [backlogId, tenantA, sourceUrl],
    )
    assert.equal(approvedStart.rows[0].id, backlogId)

    await admin.query(
      'insert into ap.candidate_news (id, cliente_id, criado_por_user_id, url_original) values ($1, $2, $3, $4)',
      [candidateId, tenantA, userA, sourceUrl],
    )
    await assert.rejects(
      actorA.query(
        'select * from ap.link_news_backlog_candidate($1, $2, $3, $4, $5)',
        [backlogId, tenantA, candidateId, userA, sourceUrl],
      ),
      (error) => error?.code === '42501',
    )
    const linked = await service.query(
      'select * from ap.link_news_backlog_candidate($1, $2, $3, $4, $5)',
      [backlogId, tenantA, candidateId, userA, sourceUrl],
    )
    assert.equal(linked.rows[0].candidate_news_id, candidateId)
    assert.ok(linked.rows[0].production_started_at)

    const discardable = await actorB.query(
      'select ap.create_news_backlog_item($1, $2, null, null) as result',
      [tenantA, 'https://example.com/discardable'],
    )
    const discardableId = discardable.rows[0].result.item.id
    await assert.rejects(
      otherTenant.query('select * from ap.discard_news_backlog_item($1, $2)', [discardableId, tenantA]),
      (error) => error?.code === '42501',
    )
    const discardedAvailable = await actorA.query(
      'select * from ap.discard_news_backlog_item($1, $2)', [discardableId, tenantA],
    )
    assert.equal(discardedAvailable.rows[0].status, 'archived')
    const afterDiscardList = await actorA.query('select id from ap.list_news_backlog($1)', [tenantA])
    assert.ok(!afterDiscardList.rows.some(row => row.id === discardableId))

    const claimed = await actorA.query(
      'select ap.create_news_backlog_item($1, $2, null, null) as result',
      [tenantA, 'https://example.com/claimed-then-discarded'],
    )
    const claimedId = claimed.rows[0].result.item.id
    await actorA.query('select * from ap.adopt_news_backlog_item($1, $2)', [claimedId, tenantA])
    await assert.rejects(
      actorB.query('select * from ap.discard_news_backlog_item($1, $2)', [claimedId, tenantA]),
      (error) => error?.code === '42501',
    )
    const discardedMine = await actorA.query(
      'select * from ap.discard_news_backlog_item($1, $2)', [claimedId, tenantA],
    )
    assert.equal(discardedMine.rows[0].status, 'archived')

    await assert.rejects(
      actorA.query('select * from ap.discard_news_backlog_item($1, $2)', [backlogId, tenantA]),
      (error) => error?.code === '42501',
    )
    const discardEvents = await admin.query(
      'select action from ap.news_backlog_events where backlog_id = $1 order by created_at, id',
      [discardableId],
    )
    assert.deepEqual(discardEvents.rows.map(row => row.action), ['created', 'discarded'])

    const events = await admin.query(
      'select action, actor_user_id from ap.news_backlog_events where backlog_id = $1 order by created_at, id',
      [backlogId],
    )
    assert.deepEqual(events.rows.map(row => row.action), ['created', 'adopted', 'released', 'adopted', 'linked'])
    assert.equal(events.rows.at(-1).actor_user_id, userA)

    await admin.query(
      'update ap.system_config set shared_news_backlog_enabled = false where cliente_id = $1',
      [tenantB],
    )
    await assert.rejects(
      otherTenant.query('select * from ap.list_news_backlog($1)', [tenantB]),
      (error) => error?.code === '42501' && error?.message.includes('BACKLOG_FEATURE_DISABLED'),
    )
  } finally {
    await Promise.allSettled([admin.end(), actorA?.end(), actorB?.end(), otherTenant?.end(), service?.end()])
  }
})
