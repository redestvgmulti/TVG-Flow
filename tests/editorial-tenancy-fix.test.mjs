import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

import {
  authorizeConfigRequest,
  ConfigAuthorizationError,
} from '../supabase/functions/ap-config/authorization.ts'
import { toEditorialAuthorizationCode } from '../supabase/functions/_shared/editorialTenantErrors.ts'

const USER = '11111111-1111-4111-8111-111111111111'
const CLIENT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const CLIENT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const root = new URL('../', import.meta.url)

function userClient({ clients = [CLIENT_A], resolver = CLIENT_A, resolverError = null, role = 'admin' } = {}) {
  return {
    auth: { async getUser() { return { data: { user: { id: USER } }, error: null } } },
    async rpc(name) {
      if (name === 'get_current_identity') {
        return { data: { id: USER, ativo: true, access_ready: true, role }, error: null }
      }
      assert.equal(name, 'require_single_operational_cliente_id')
      return { data: resolver, error: resolverError }
    },
    schema(name) {
      assert.equal(name, 'ap')
      return {
        async rpc(name) {
          assert.equal(name, 'get_operational_cliente_ids')
          return { data: clients.map(cliente_id => ({ cliente_id })), error: null }
        },
      }
    },
    from() { throw new Error('super admin path must not select a tenant') },
  }
}

async function expectCode(promise, code, status) {
  await assert.rejects(promise, error => {
    assert.ok(error instanceof ConfigAuthorizationError)
    assert.equal(error.code, code)
    assert.equal(error.status, status)
    return true
  })
}

async function resolveEditorialTenant(client) {
  return await authorizeConfigRequest({
    authorization: 'Bearer signed-user-token',
    // Editorial requests intentionally never propagate a browser cliente_id.
    requestedClienteId: undefined,
    createUserClient: () => client,
  })
}

test('editorial tenant resolution uses the canonical single-tenant resolver', async () => {
  const result = await resolveEditorialTenant(userClient())
  assert.deepEqual(result, { userId: USER, role: 'admin', clienteId: CLIENT_A })
})

test('editorial tenant resolution fails closed for zero or multiple tenants', async () => {
  await expectCode(
    resolveEditorialTenant(userClient({ clients: [] })),
    'OPERATIONAL_CLIENT_NOT_FOUND',
    403,
  )
  await expectCode(
    resolveEditorialTenant(userClient({
      clients: [CLIENT_A, CLIENT_B],
      resolverError: new Error('OPERATIONAL_CLIENT_SELECTION_REQUIRED'),
    })),
    'OPERATIONAL_CLIENT_SELECTION_REQUIRED',
    409,
  )
})

test('editorial error codes make zero and multiple operational tenants explicit', () => {
  assert.equal(toEditorialAuthorizationCode('OPERATIONAL_CLIENT_NOT_FOUND'), 'NO_OPERATIONAL_CLIENT')
  assert.equal(
    toEditorialAuthorizationCode('OPERATIONAL_CLIENT_SELECTION_REQUIRED'),
    'OPERATIONAL_CLIENT_SELECTION_REQUIRED',
  )
})

test('an attempted browser tenant is not part of the editorial authorization contract', async () => {
  const result = await resolveEditorialTenant(userClient())
  assert.equal(result.clienteId, CLIENT_A)
  assert.notEqual(result.clienteId, CLIENT_B)
})

test('super admins receive no implicit editorial tenant', async () => {
  await expectCode(
    resolveEditorialTenant(userClient({ role: 'super_admin' })),
    'OPERATIONAL_CLIENT_SELECTION_REQUIRED',
    409,
  )
})

test('editorial endpoints derive one tenant before privileged queries and scope each resource', async () => {
  const files = [
    'supabase/functions/ap-editorial-settings/index.ts',
    'supabase/functions/ap-editorial-prompt/index.ts',
    'supabase/functions/ap-editorial-rag-upload/index.ts',
    'supabase/functions/ap-editorial-test/index.ts',
  ]
  for (const path of files) {
    const source = await readFile(new URL(path, root), 'utf8')
    assert.doesNotMatch(source, /FIXED_CLIENT_ID|cd287e6e-f273-4d0f-a72d-2a8c391e40e9/)
    assert.match(source, /requireEditorialAdmin\(req, sbAdmin\)/)
    assert.match(source, /const clienteId = authorization\.clienteId/)
  }

  const [settings, prompt, rag, endpoint] = await Promise.all(
    files.map(path => readFile(new URL(path, root), 'utf8')),
  )
  assert.match(settings, /\.eq\("cliente_id", clienteId\)/)
  assert.match(settings, /\.eq\("id", id\)[\s\S]*?\.eq\("cliente_id", clienteId\)/)
  assert.match(prompt, /\.update\(\{ is_active: false \}\)[\s\S]*?\.eq\("cliente_id", clienteId\)/)
  assert.match(rag, /\.delete\(\)[\s\S]*?\.eq\("cliente_id", clienteId\)/)
  assert.match(endpoint, /p_cliente_id: clienteId/)
  assert.match(endpoint, /cliente_id: clienteId/)
})

test('the settings UI sends editorial rules through the server-authorized endpoint only', async () => {
  const source = await readFile(new URL('src/pages/admin/AutoPublisherSettings.jsx', root), 'utf8')
  assert.doesNotMatch(source, /FIXED_CLIENT_ID|cd287e6e-f273-4d0f-a72d-2a8c391e40e9/)
  assert.doesNotMatch(source, /from\('editorial_rules'\)/)
  assert.match(source, /invoke\('ap-editorial-settings', \{[\s\S]*?method: 'POST'/)
  assert.match(source, /invoke\('ap-editorial-settings', \{[\s\S]*?method: 'DELETE'/)
  assert.match(source, /NO_OPERATIONAL_CLIENT/)
  assert.match(source, /OPERATIONAL_CLIENT_SELECTION_REQUIRED/)
})
