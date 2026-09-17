import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { publishLegacyFeed, supabasePublicationStore } from '../../supabase/functions/ap-instagram-publisher/publicationWorkflow.mjs'

function harness(responses, { finishFails = false, confirmFails = false } = {}) {
  let stage = null, posted = false, calls = 0, active = false
  const attempts = []
  const store = {
    async claim() {
      if (active) return null
      active = true; stage = 'claimed'; attempts.push({})
      return { attempt_id: 'attempt', render_url: 'https://example.com/art.png', caption: 'Human caption' }
    },
    async advance(_id, expected, next, fields) {
      assert.equal(stage, expected)
      if (confirmFails && next === 'confirmed') throw new Error('DB down')
      stage = next; Object.assign(attempts.at(-1), fields)
      if (stage === 'safe_failed') active = false
    },
    async finish() { assert.equal(stage, 'confirmed'); if (finishFails) throw new Error('DB down'); posted = true },
  }
  const fetchImpl = async (_url, options) => {
    calls++
    const response = responses.shift()
    if (response === 'timeout') return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('timeout'))))
    if (response instanceof Error) throw response
    return new Response(JSON.stringify(response.body), { status: response.status })
  }
  return {
    run: () => publishLegacyFeed({ store, fetchImpl, candidateId: 'candidate', accountId: '12345', token: 'test-only', timeoutMs: 10 }),
    finish: () => store.finish(),
    state: () => ({ stage, posted, calls, attempts }),
  }
}
const ok = id => ({ status: 200, body: { id } })
for (const status of [400, 500]) test(`/media ${status}: safe failure, never publish`, async () => {
  const h = harness([{ status, body: { error: { code: 100 } } }])
  assert.equal((await h.run()).outcome, 'safe_failed')
  assert.equal(h.state().calls, 1); assert.equal(h.state().posted, false)
})
for (const body of [{}, { id: '' }, { id: 123 }, { id: 'invalid' }]) test(`/media invalid ID ${JSON.stringify(body)}`, async () => {
  const h = harness([{ status: 200, body }]); assert.equal((await h.run()).outcome, 'safe_failed'); assert.equal(h.state().calls, 1)
})
for (const status of [400, 500]) test(`/media_publish ${status}: reconciliation, never blind retry`, async () => {
  const h = harness([ok('100'), { status, body: { error: { code: 100 } } }])
  assert.equal((await h.run()).outcome, 'reconciliation_required')
  assert.equal((await h.run()).outcome, 'not_claimed')
  assert.equal(h.state().calls, 2); assert.equal(h.state().posted, false)
})
test('missing post ID does not become posted', async () => {
  const h = harness([ok('100'), { status: 200, body: {} }])
  assert.equal((await h.run()).outcome, 'reconciliation_required'); assert.equal(h.state().posted, false)
})
test('local update fails after external success: durable evidence and no second publish', async () => {
  const h = harness([ok('100'), ok('200')], { finishFails: true })
  assert.equal((await h.run()).outcome, 'reconciliation_required')
  assert.equal(h.state().stage, 'confirmed'); assert.equal(h.state().attempts[0].externalId, '200')
  assert.equal((await h.run()).outcome, 'not_claimed'); assert.equal(h.state().calls, 2)
})
test('confirmation persistence fails: publishing barrier survives and response carries known ID', async () => {
  const h = harness([ok('100'), ok('200')], { confirmFails: true })
  assert.equal((await h.run()).externalMediaId, '200'); assert.equal(h.state().stage, 'publishing')
  assert.equal((await h.run()).outcome, 'not_claimed')
})
test('timeout after irreversible request stays ambiguous across retry', async () => {
  const h = harness([ok('100'), 'timeout'])
  assert.equal((await h.run()).outcome, 'reconciliation_required')
  assert.equal((await h.run()).outcome, 'not_claimed'); assert.equal(h.state().calls, 2)
})
test('concurrent workers dispatch only once (PostgreSQL claim tested separately)', async () => {
  const h = harness([ok('100'), ok('200')])
  const outcomes = await Promise.all([h.run(), h.run()])
  assert.deepEqual(outcomes.map(x => x.outcome).sort(), ['not_claimed', 'posted']); assert.equal(h.state().calls, 2)
})
test('retry after create failure is safe', async () => {
  const h = harness([{ status: 500, body: {} }, ok('100'), ok('200')])
  assert.equal((await h.run()).outcome, 'safe_failed'); assert.equal((await h.run()).outcome, 'posted')
})
test('database adapter rejects errors instead of claiming success', async () => {
  const s = supabasePublicationStore({ schema: () => ({ rpc: async () => ({ error: { code: 'failure' } }) }) })
  await assert.rejects(s.finish('id'), /DATABASE_P0_FINISH_PUBLICATION_FAILED/)
})

test('publisher is disabled by default and only selects approved generation-backed Feed', async () => {
  const source = await readFile(new URL('../../supabase/functions/ap-instagram-publisher/index.ts',import.meta.url),'utf8')
  assert.ok(source.indexOf('AP_LEGACY_PUBLISH_ENABLED') < source.indexOf('const supabase = createClient'))
  assert.match(source, /AP_LEGACY_PUBLISH_ENABLED"\) !== "true"/)
  assert.match(source, /rpc\("p0_list_publish_candidates"/)
  const migration = await readFile(new URL('../../supabase/migrations/20260909014825_p0_editorial_publication_render_invariants.sql',import.meta.url),'utf8')
  const selection=migration.split('CREATE FUNCTION ap.p0_list_publish_candidates')[1].split('CREATE FUNCTION ap.p0_claim_publication')[0]
  assert.match(selection, /c\.content_type='feed'/)
  assert.match(selection, /g\.id=c\.approved_generation_id/)
  assert.match(selection, /NOT EXISTS[\s\S]*legacy_publish_attempts[\s\S]*LIMIT/)
  assert.doesNotMatch(source, /\.update\(/)
})
