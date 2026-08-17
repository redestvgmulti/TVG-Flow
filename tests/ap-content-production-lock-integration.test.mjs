import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import pg from 'pg'

const { Client } = pg
const databaseUrl = process.env.TVG_LOCK_TEST_DATABASE_URL
const migrationUrl = new URL(
  '../supabase/migrations/20260817133000_add_atomic_content_production_lock.sql',
  import.meta.url,
)

const candidateId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const tenantA = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const tenantB = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const workerA = '11111111-1111-4111-8111-111111111111'
const workerB = '22222222-2222-4222-8222-222222222222'
const workerOld = '33333333-3333-4333-8333-333333333333'

const callLock = (client, {
  expectedTenant = tenantA,
  expectedStatus = 'selected',
  expectedProcessingStartedAt = null,
  expectedWorkerId = null,
  workerId,
}) => client.query(
  `select * from ap.acquire_content_production_lock(
    $1::uuid, $2::uuid, $3::text, $4::timestamptz, $5::uuid, $6::uuid
  )`,
  [
    candidateId,
    expectedTenant,
    expectedStatus,
    expectedProcessingStartedAt,
    expectedWorkerId,
    workerId,
  ],
)

test('atomic lock RPC serializes concurrent workers and preserves TTL and tenant boundaries', {
  skip: !databaseUrl,
}, async () => {
  const admin = new Client({ connectionString: databaseUrl })
  let workerOne
  let workerTwo
  let unauthorized

  await admin.connect()
  try {
    await admin.query(`
      create role anon noinherit;
      create role authenticated noinherit login password 'authenticated-test-only';
      create role service_role noinherit login password 'service-test-only';
      create schema auth;
      create function auth.jwt() returns jsonb
        language sql stable
        as $$ select jsonb_build_object('role', session_user) $$;
      create schema ap;
      create table ap.candidate_news (
        id uuid primary key,
        cliente_id uuid not null,
        status text not null,
        processing_started_at timestamptz,
        worker_id uuid
      );
      grant usage on schema ap to service_role;
    `)
    await admin.query(await readFile(migrationUrl, 'utf8'))
    await admin.query(
      `insert into ap.candidate_news (id, cliente_id, status)
       values ($1, $2, 'selected')`,
      [candidateId, tenantA],
    )

    const serviceUrl = new URL(databaseUrl)
    serviceUrl.username = 'service_role'
    serviceUrl.password = 'service-test-only'
    workerOne = new Client({ connectionString: serviceUrl.toString() })
    workerTwo = new Client({ connectionString: serviceUrl.toString() })
    await Promise.all([workerOne.connect(), workerTwo.connect()])

    const authenticatedUrl = new URL(databaseUrl)
    authenticatedUrl.username = 'authenticated'
    authenticatedUrl.password = 'authenticated-test-only'
    unauthorized = new Client({ connectionString: authenticatedUrl.toString() })
    await unauthorized.connect()
    await assert.rejects(
      callLock(unauthorized, { workerId: workerA }),
      (error) => error?.code === '42501',
    )

    const [raceA, raceB] = await Promise.all([
      callLock(workerOne, { workerId: workerA }),
      callLock(workerTwo, { workerId: workerB }),
    ])
    assert.equal(raceA.rowCount + raceB.rowCount, 1)

    const winner = await admin.query(
      'select processing_started_at, worker_id from ap.candidate_news where id = $1',
      [candidateId],
    )
    assert.ok(winner.rows[0].processing_started_at)
    assert.ok([workerA, workerB].includes(winner.rows[0].worker_id))

    const validLock = await callLock(workerOne, {
      expectedProcessingStartedAt: winner.rows[0].processing_started_at,
      expectedWorkerId: winner.rows[0].worker_id,
      workerId: workerOld,
    })
    assert.equal(validLock.rowCount, 0)

    const staleAt = new Date(Date.now() - 11 * 60 * 1000)
    await admin.query(
      `update ap.candidate_news
       set processing_started_at = $2, worker_id = $3
       where id = $1`,
      [candidateId, staleAt, workerOld],
    )
    const staleRecovery = await callLock(workerOne, {
      expectedProcessingStartedAt: staleAt,
      expectedWorkerId: workerOld,
      workerId: workerA,
    })
    assert.equal(staleRecovery.rowCount, 1)
    assert.equal(staleRecovery.rows[0].worker_id, workerA)

    await admin.query(
      `update ap.candidate_news
       set processing_started_at = null, worker_id = null
       where id = $1`,
      [candidateId],
    )
    const wrongTenant = await callLock(workerOne, {
      expectedTenant: tenantB,
      workerId: workerA,
    })
    assert.equal(wrongTenant.rowCount, 0)

    const finalCandidate = await admin.query(
      'select status, processing_started_at, worker_id from ap.candidate_news where id = $1',
      [candidateId],
    )
    assert.deepEqual(finalCandidate.rows[0], {
      status: 'selected',
      processing_started_at: null,
      worker_id: null,
    })
  } finally {
    await Promise.allSettled([
      admin.end(),
      workerOne?.end(),
      workerTwo?.end(),
      unauthorized?.end(),
    ])
  }
})
