import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')
const EXPIRY_CUTOFF = '2026-08-17T12:00:00.000Z'
const FREE_CANDIDATE = {
  id: 'candidate-1',
  cliente_id: 'tenant-a',
  status: 'selected',
  processing_started_at: null,
  worker_id: null,
}

class AtomicCandidateStore {
  constructor(candidate) {
    this.candidate = { ...candidate }
  }

  async acquire(observed, workerId, lockTime, expiryCutoff = EXPIRY_CUTOFF) {
    await Promise.resolve()
    const current = this.candidate
    const eligible = current.processing_started_at == null
      || Date.parse(current.processing_started_at) < Date.parse(expiryCutoff)
    const observedStateStillMatches = current.id === observed.id
      && current.cliente_id === observed.cliente_id
      && current.status === 'selected'
      && current.status === observed.status
      && current.processing_started_at === observed.processing_started_at
      && current.worker_id === observed.worker_id

    if (!eligible || !observedStateStillMatches) return false
    this.candidate = { ...current, processing_started_at: lockTime, worker_id: workerId }
    return true
  }
}

test('content production delegates the lock to the atomic RPC with all observed values', async () => {
  const content = await source('supabase/functions/ap-content-production/index.ts')
  const lockBlock = content.slice(
    content.indexOf('.rpc("acquire_content_production_lock"'),
    content.indexOf('if (lockError || !lockData)'),
  )

  assert.match(content, /const LOCK_EXPIRY_MINUTES = 10/)
  assert.match(lockBlock, /p_candidate_id: item\.id/)
  assert.match(lockBlock, /p_expected_cliente_id: item\.cliente_id/)
  assert.match(lockBlock, /p_expected_status: item\.status/)
  assert.match(lockBlock, /p_expected_processing_started_at: item\.processing_started_at/)
  assert.match(lockBlock, /p_expected_worker_id: item\.worker_id/)
  assert.match(lockBlock, /p_worker_id: workerId/)
  assert.doesNotMatch(lockBlock, /\.or\(/)
})

test('the lock RPC is one service-role-only UPDATE CAS with the existing ten-minute TTL', async () => {
  const migration = await source('supabase/migrations/20260817133000_add_atomic_content_production_lock.sql')

  assert.match(migration, /SECURITY DEFINER/)
  assert.match(migration, /auth\.jwt\(\) ->> 'role'.*'service_role'/s)
  assert.match(migration, /REVOKE ALL[\s\S]*FROM PUBLIC, anon, authenticated/)
  assert.match(migration, /GRANT EXECUTE[\s\S]*TO service_role/)
  assert.match(migration, /UPDATE ap\.candidate_news AS candidate/)
  assert.match(migration, /candidate\.cliente_id = p_expected_cliente_id/)
  assert.match(migration, /candidate\.status = p_expected_status/)
  assert.match(migration, /processing_started_at IS NOT DISTINCT FROM[\s\S]*p_expected_processing_started_at/)
  assert.match(migration, /worker_id IS NOT DISTINCT FROM p_expected_worker_id/)
  assert.match(migration, /interval '10 minutes'/)
  assert.doesNotMatch(migration, /\bDELETE\b|\bTRUNCATE\b|\bALTER TABLE\b/i)
})

test('a free selected candidate is acquired and records one worker and timestamp', async () => {
  const store = new AtomicCandidateStore(FREE_CANDIDATE)
  assert.equal(await store.acquire({ ...store.candidate }, 'worker-a', '2026-08-17T12:01:00.000Z'), true)
  assert.equal(store.candidate.worker_id, 'worker-a')
  assert.equal(store.candidate.processing_started_at, '2026-08-17T12:01:00.000Z')
})

test('two concurrent workers produce exactly one successful acquisition', async () => {
  const store = new AtomicCandidateStore(FREE_CANDIDATE)
  const observedA = { ...store.candidate }
  const observedB = { ...store.candidate }

  const results = await Promise.all([
    store.acquire(observedA, 'worker-a', '2026-08-17T12:01:00.000Z'),
    store.acquire(observedB, 'worker-b', '2026-08-17T12:01:00.001Z'),
  ])

  assert.equal(results.filter(Boolean).length, 1)
  assert.equal(results.filter((result) => !result).length, 1)
  assert.ok(['worker-a', 'worker-b'].includes(store.candidate.worker_id))
})

test('a valid lock cannot be replaced by another worker', async () => {
  const store = new AtomicCandidateStore({
    ...FREE_CANDIDATE,
    processing_started_at: '2026-08-17T12:05:00.000Z',
    worker_id: 'worker-a',
  })

  assert.equal(await store.acquire({ ...store.candidate }, 'worker-b', '2026-08-17T12:06:00.000Z'), false)
  assert.equal(store.candidate.worker_id, 'worker-a')
})

test('an expired lock is recovered only while tenant and observed lock values match', async () => {
  const stale = {
    ...FREE_CANDIDATE,
    processing_started_at: '2026-08-17T11:49:59.999Z',
    worker_id: 'worker-old',
  }
  const store = new AtomicCandidateStore(stale)
  assert.equal(await store.acquire({ ...stale }, 'worker-new', '2026-08-17T12:01:00.000Z'), true)
  assert.equal(store.candidate.worker_id, 'worker-new')

  const changedStore = new AtomicCandidateStore({ ...stale, worker_id: 'worker-changed' })
  assert.equal(await changedStore.acquire({ ...stale }, 'worker-new', '2026-08-17T12:01:00.000Z'), false)

  const wrongTenantStore = new AtomicCandidateStore(stale)
  assert.equal(await wrongTenantStore.acquire({ ...stale, cliente_id: 'tenant-b' }, 'worker-new', '2026-08-17T12:01:00.000Z'), false)
  assert.equal(wrongTenantStore.candidate.worker_id, 'worker-old')
})

test('tenant authorization remains before the service-role RPC and editorial behavior is unchanged', async () => {
  const content = await source('supabase/functions/ap-content-production/index.ts')
  const authorizationPosition = content.indexOf('authorizeOperationalTenant({')
  const lockPosition = content.indexOf('.rpc("acquire_content_production_lock"')

  assert.ok(authorizationPosition >= 0)
  assert.ok(lockPosition > authorizationPosition)
  assert.match(content, /canonicalEditorialFields\(item\)/)
  assert.doesNotMatch(content, /runEditorialWorkflow|callLLM/)
})
