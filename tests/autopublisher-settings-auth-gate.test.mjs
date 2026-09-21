import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

test('AutoPublisher settings waits for an authenticated session before calling protected functions', async () => {
  const root = new URL('../', import.meta.url)
  const source = await readFile(new URL('src/pages/admin/AutoPublisherSettings.jsx', root), 'utf8')

  assert.match(source, /const \{ authReady, authStatus \} = useAuth\(\)/)
  assert.match(source, /if \(!authReady \|\| authStatus !== 'authenticated'\)/)
  assert.match(source, /await supabase\.auth\.getSession\(\)/)
  assert.match(source, /Authorization: `Bearer \$\{session\.access_token\}`/)
  assert.match(source, /invokeAuthenticatedFunction\('ap-config'/)
  assert.match(source, /invokeAuthenticatedFunction\('ap-editorial-settings'/)
  assert.match(source, /invokeAuthenticatedFunction\('ap-editorial-rag-upload'/)
  assert.match(source, /invokeAuthenticatedFunction\('ap-source-probe'/)
  assert.match(source, /invokeAuthenticatedFunction\('ap-editorial-prompt'/)
  assert.match(source, /invokeAuthenticatedFunction\('ap-editorial-test'/)
  assert.doesNotMatch(source, /supabase\.functions\.invoke\('/)
})
