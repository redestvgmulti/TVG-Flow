import assert from 'node:assert/strict'
import { test } from 'node:test'
import { META_OAUTH_PENDING_TENANT_KEY, startMetaConnection } from './metaIntegration.js'

test('OAuth start keeps the chosen tenant in this browser tab, not in the terminator URI', async () => {
  const values = new Map()
  const previousWindow = globalThis.window
  globalThis.window = {
    sessionStorage: {
      setItem: (key, value) => values.set(key, value),
      removeItem: key => values.delete(key),
    },
  }
  try {
    const supabase = {
      functions: {
        invoke: async (_name, options) => {
          assert.equal(options.headers['x-ap-cliente-id'], 'fixture-tenant')
          return { data: { authorize_url: 'https://www.facebook.com/dialog/oauth?fixture=1' } }
        },
      },
    }
    const authorizeUrl = await startMetaConnection(supabase, 'fixture-tenant')
    assert.equal(authorizeUrl.includes('fixture-tenant'), false)
    assert.equal(values.get(META_OAUTH_PENDING_TENANT_KEY), 'fixture-tenant')
  } finally {
    globalThis.window = previousWindow
  }
})
