import assert from 'node:assert/strict'
import test from 'node:test'
import { prepareEditorialAiDraft } from '../src/services/editorialArticlesService.js'

test('editorial draft sends the active user token', async () => {
  const calls = []
  const supabase = {
    auth: {
      getSession: async () => ({ data: { session: { access_token: 'active-token', expires_at: Date.now() / 1000 + 3600 } }, error: null }),
      refreshSession: async () => { throw new Error('Unexpected refresh') },
    },
    functions: {
      invoke: async (_name, options) => {
        calls.push(options)
        return { data: { success: true, draft: { headline: 'Ready' } }, error: null }
      },
    },
  }

  await prepareEditorialAiDraft(supabase, { articleId: 'article-id', requestId: 'request-id' })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].headers.Authorization, 'Bearer active-token')
  assert.deepEqual(calls[0].body, { article_id: 'article-id', request_id: 'request-id' })
})

test('editorial draft refreshes once after a 401 and keeps the request id', async () => {
  const tokens = []
  let refreshes = 0
  const supabase = {
    auth: {
      getSession: async () => ({ data: { session: { access_token: 'old-token', expires_at: Date.now() / 1000 + 3600 } }, error: null }),
      refreshSession: async () => {
        refreshes += 1
        return { data: { session: { access_token: 'new-token' } }, error: null }
      },
    },
    functions: {
      invoke: async (_name, options) => {
        tokens.push(options.headers.Authorization)
        assert.equal(options.body.request_id, 'request-id')
        return tokens.length === 1
          ? { data: null, error: { context: { status: 401 } } }
          : { data: { success: true, draft: { headline: 'Ready' } }, error: null }
      },
    },
  }

  await prepareEditorialAiDraft(supabase, { articleId: 'article-id', requestId: 'request-id' })
  assert.equal(refreshes, 1)
  assert.deepEqual(tokens, ['Bearer old-token', 'Bearer new-token'])
})

test('editorial draft refuses a missing session before invoking the function', async () => {
  const supabase = {
    auth: { getSession: async () => ({ data: { session: null }, error: null }) },
    functions: { invoke: async () => { throw new Error('Unexpected invocation') } },
  }
  await assert.rejects(
    prepareEditorialAiDraft(supabase, { articleId: 'article-id', requestId: 'request-id' }),
    { code: 'AUTH_REQUIRED' },
  )
})
