import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import pg from 'pg'

const { Client } = pg
const databaseUrl = process.env.TVG_BACKLOG_TEST_DATABASE_URL
const migrationUrl = new URL(
  '../supabase/migrations/20260817150000_create_shared_news_backlog.sql',
  import.meta.url,
)
const discardMigrationUrl = new URL(
  '../supabase/migrations/20260823190000_add_discard_news_backlog_item.sql',
  import.meta.url,
)
const titleEditingMigrationUrl = new URL(
  '../supabase/migrations/20260824110000_add_news_backlog_title_editing.sql',
  import.meta.url,
)

const tenantA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const tenantB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const userA = '11111111-1111-4111-8111-111111111111'
const userB = '22222222-2222-4222-8222-222222222222'
const userOtherTenant = '33333333-3333-4333-8333-333333333333'
const candidateId = '44444444-4444-4444-8444-444444444444'
const sourceUrl = 'https://example.com/pauta-controlada'

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('backlog migration is prospective and keeps the editorial queue isolated', async () => {
  const migration = await source('supabase/migrations/20260817150000_create_shared_news_backlog.sql')
  assert.match(migration, /CREATE TABLE ap\.news_backlog/)
  assert.match(migration, /CREATE TABLE ap\.news_backlog_events/)
  assert.match(migration, /status IN \('available', 'adopted', 'archived'\)/)
  assert.match(migration, /UPDATE ap\.news_backlog AS backlog[\s\S]*status = 'adopted'/)
  assert.match(migration, /AND backlog\.status = 'available'/)
  assert.match(migration, /AND backlog\.adopted_by_user_id IS NULL/)
  assert.match(migration, /auth\.uid\(\)/)
  assert.match(migration, /REVOKE ALL ON TABLE ap\.news_backlog FROM PUBLIC, anon, authenticated/)
  assert.match(migration, /GRANT EXECUTE ON FUNCTION ap\.adopt_news_backlog_item\(uuid, uuid\) TO authenticated/)
  assert.match(migration, /GRANT EXECUTE ON FUNCTION ap\.link_news_backlog_candidate[\s\S]*TO service_role/)
  assert.doesNotMatch(migration, /UPDATE\s+ap\.candidate_news/i)
  assert.doesNotMatch(migration, /DELETE\s+FROM\s+ap\.candidate_news/i)
  assert.doesNotMatch(migration, /ALTER TABLE\s+ap\.candidate_news/i)
})

test('discard migration archives without weakening tenant/adopter isolation', async () => {
  const migration = await source('supabase/migrations/20260823190000_add_discard_news_backlog_item.sql')
  assert.match(migration, /CREATE OR REPLACE FUNCTION ap\.discard_news_backlog_item/)
  assert.match(migration, /require_news_backlog_access/)
  assert.match(migration, /backlog\.status = 'available'/)
  assert.match(migration, /backlog\.adopted_by_user_id = v_actor\.user_id/)
  assert.match(migration, /candidate_news_id IS NULL/)
  assert.match(migration, /GRANT EXECUTE ON FUNCTION ap\.discard_news_backlog_item\(uuid, uuid\) TO authenticated/)
  assert.match(migration, /status <> 'archived'/)
})

test('productive generator accepts a backlog reference only after user-bound authorization and links it before rendering', async () => {
  const generator = await source('supabase/functions/ap-employee-generator/index.ts')
  assert.match(generator, /backlog_id: rawBacklogId = null/)
  assert.match(generator, /assert_news_backlog_production_access/)
  assert.match(generator, /link_news_backlog_candidate/)
  assert.match(generator, /BACKLOG_PRODUCTION_FORBIDDEN/)
  assert.match(generator, /BACKLOG_LINK_FAILED/)
  assert.doesNotMatch(generator, /runEditorialWorkflow|callLLM/)
})

test('backlog UI resolves non-Instagram metadata internally and requires a manual Instagram title', async () => {
  const panel = await source('src/components/editorial/NewsBacklogPanel.jsx')
  const adminUi = await source('src/pages/admin/AutoPublisher.jsx')
  const employeeUi = await source('src/pages/admin/EmployeeMode.jsx')
  assert.match(panel, /create_news_backlog_item/)
  assert.match(panel, /adopt_news_backlog_item/)
  assert.match(panel, /release_news_backlog_item/)
  assert.match(panel, /discard_news_backlog_item/)
  assert.match(panel, /ap-link-scraper/)
  assert.match(panel, /isInstagramUrl/)
  assert.match(panel, /manual_instagram/)
  assert.match(panel, /update_news_backlog_title/)
  assert.doesNotMatch(panel, /ap-employee-generator|ap-render-engine/)
  assert.match(adminUi, /NewsBacklogPanel/)
  assert.match(adminUi, /backlog_id: item\.id/)
  assert.match(employeeUi, /NewsBacklogPanel/)
  assert.match(employeeUi, /backlog_id: item\.id/)
})

test('title editing migration preserves backlog access boundaries', async () => {
  const migration = await readFile(titleEditingMigrationUrl, 'utf8')
  assert.match(migration, /CREATE OR REPLACE FUNCTION ap\.update_news_backlog_title/)
  assert.match(migration, /require_news_backlog_access/)
  assert.match(migration, /length\(v_title\) < 3/)
  assert.match(migration, /backlog\.status = 'available' OR backlog\.adopted_by_user_id = v_actor\.user_id/)
  assert.match(migration, /GRANT EXECUTE ON FUNCTION ap\.update_news_backlog_title\(uuid, uuid, text\) TO authenticated/)
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

test('PostgreSQL backlog adoption is atomic, tenant scoped, releasable only by its adopter, and links only through service_role', {
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
      create table public.profissionais (id uuid primary key, nome text, role text, ativo boolean);
      create table public.backlog_test_memberships (user_id uuid, cliente_id uuid);
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
    await admin.query(await readFile(migrationUrl, 'utf8'))
    await admin.query(await readFile(discardMigrationUrl, 'utf8'))
    await admin.query(
      'insert into public.clientes (id) values ($1), ($2)',
      [tenantA, tenantB],
    )
    await admin.query(
      `insert into public.profissionais (id, nome, role, ativo) values
        ($1, 'Ana', 'staff', true),
        ($2, 'Bruno', 'staff', true),
        ($3, 'Carla', 'staff', true)`,
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
      'select * from ap.create_news_backlog_item($1, $2, $3, $4)',
      [tenantA, sourceUrl, 'Pauta de teste', 'Somente teste PostgreSQL'],
    )
    const backlogId = created.rows[0].id
    assert.equal(created.rows[0].status, 'available')
    assert.equal(created.rows[0].created_by_user_id, userA)

    await assert.rejects(
      otherTenant.query('select * from ap.list_news_backlog($1)', [tenantA]),
      (error) => error?.code === '42501',
    )
    await assert.rejects(
      otherTenant.query('select * from ap.adopt_news_backlog_item($1, $2)', [backlogId, tenantA]),
      (error) => error?.code === '42501',
    )

    const adoption = (client) => client.query(
      'select * from ap.adopt_news_backlog_item($1, $2)', [backlogId, tenantA],
    )
    const race = await Promise.allSettled([adoption(actorA), adoption(actorB)])
    assert.equal(race.filter(result => result.status === 'fulfilled').length, 1)
    assert.equal(race.filter(result => result.status === 'rejected').length, 1)

    const afterRace = await admin.query(
      'select status, adopted_by_user_id, adopted_at from ap.news_backlog where id = $1', [backlogId],
    )
    assert.equal(afterRace.rows[0].status, 'adopted')
    assert.ok([userA, userB].includes(afterRace.rows[0].adopted_by_user_id))
    assert.ok(afterRace.rows[0].adopted_at)
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
    assert.equal(released.rows[0].adopted_by_user_id, null)

    await actorA.query('select * from ap.adopt_news_backlog_item($1, $2)', [backlogId, tenantA])
    await assert.rejects(
      actorB.query('select * from ap.assert_news_backlog_production_access($1, $2, $3)', [backlogId, tenantA, sourceUrl]),
      (error) => error?.code === '42501',
    )
    const approvedStart = await actorA.query(
      'select (ap.assert_news_backlog_production_access($1, $2, $3)).*', [backlogId, tenantA, sourceUrl],
    )
    assert.equal(approvedStart.rows[0].id, backlogId)

    await admin.query(
      'insert into ap.candidate_news (id, cliente_id, criado_por_user_id, url_original) values ($1, $2, $3, $4)',
      [candidateId, tenantA, userA, sourceUrl],
    )
    await assert.rejects(
      actorA.query('select * from ap.link_news_backlog_candidate($1, $2, $3, $4, $5)', [backlogId, tenantA, candidateId, userA, sourceUrl]),
      (error) => error?.code === '42501',
    )
    const linked = await service.query(
      'select * from ap.link_news_backlog_candidate($1, $2, $3, $4, $5)', [backlogId, tenantA, candidateId, userA, sourceUrl],
    )
    assert.equal(linked.rows[0].candidate_news_id, candidateId)
    assert.ok(linked.rows[0].production_started_at)
    await assert.rejects(
      actorA.query('select * from ap.release_news_backlog_item($1, $2)', [backlogId, tenantA]),
      (error) => error?.code === '42501',
    )

    // Discard: anyone with backlog access can prune an unclaimed link, and it
    // disappears from the shared board once archived.
    const discardable = await actorB.query(
      'select * from ap.create_news_backlog_item($1, $2)',
      [tenantA, 'https://example.com/discardable'],
    )
    const discardableId = discardable.rows[0].id
    await assert.rejects(
      otherTenant.query('select * from ap.discard_news_backlog_item($1, $2)', [discardableId, tenantA]),
      (error) => error?.code === '42501',
    )
    const discardedAvailable = await actorA.query(
      'select * from ap.discard_news_backlog_item($1, $2)', [discardableId, tenantA],
    )
    assert.equal(discardedAvailable.rows[0].status, 'archived')
    const afterDiscardList = await actorA.query('select id from ap.list_news_backlog($1)', [tenantA])
    assert.ok(!afterDiscardList.rows.some((row) => row.id === discardableId))

    // Discard: only the adopter can discard an item they claimed.
    const claimed = await actorA.query(
      'select * from ap.create_news_backlog_item($1, $2)',
      [tenantA, 'https://example.com/claimed-then-discarded'],
    )
    const claimedId = claimed.rows[0].id
    await actorA.query('select * from ap.adopt_news_backlog_item($1, $2)', [claimedId, tenantA])
    await assert.rejects(
      actorB.query('select * from ap.discard_news_backlog_item($1, $2)', [claimedId, tenantA]),
      (error) => error?.code === '42501',
    )
    const discardedMine = await actorA.query(
      'select * from ap.discard_news_backlog_item($1, $2)', [claimedId, tenantA],
    )
    assert.equal(discardedMine.rows[0].status, 'archived')

    // Discard: an item already linked to production is locked, same as release.
    await assert.rejects(
      actorA.query('select * from ap.discard_news_backlog_item($1, $2)', [backlogId, tenantA]),
      (error) => error?.code === '42501',
    )

    const events = await admin.query(
      'select action from ap.news_backlog_events where backlog_id = $1 order by created_at, id', [backlogId],
    )
    assert.deepEqual(events.rows.map(row => row.action), ['created', 'adopted', 'released', 'adopted', 'production_started'])
  } finally {
    await Promise.allSettled([admin.end(), actorA?.end(), actorB?.end(), otherTenant?.end(), service?.end()])
  }
})
