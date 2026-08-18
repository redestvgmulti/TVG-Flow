import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  authorizeConfigRequest,
  ConfigAuthorizationError,
} from '../supabase/functions/ap-config/authorization.ts'

const USER = '11111111-1111-4111-8111-111111111111'
const CLIENT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const CLIENT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

function client({
  user = { id: USER },
  userError = null,
  identity = { id: USER, ativo: true, access_ready: true, role: 'admin' },
  identityError = null,
  clients = [CLIENT_A],
  clientsError = null,
  resolver = CLIENT_A,
  resolverError = null,
  superClient = null,
  superClientError = null,
} = {}) {
  const calls = []
  return {
    calls,
    auth: {
      async getUser(token) {
        calls.push(['getUser', token])
        return { data: { user }, error: userError }
      },
    },
    async rpc(name) {
      calls.push(['rpc', name])
      if (name === 'get_current_identity') return { data: identity, error: identityError }
      assert.equal(name, 'require_single_operational_cliente_id')
      return { data: resolver, error: resolverError }
    },
    schema(name) {
      assert.equal(name, 'ap')
      return {
        async rpc(functionName) {
          calls.push(['schemaRpc', functionName])
          assert.equal(functionName, 'get_operational_cliente_ids')
          return { data: clients.map(cliente_id => ({ cliente_id })), error: clientsError }
        },
      }
    },
    from(table) {
      assert.equal(table, 'clientes')
      return {
        select() { return this },
        eq() { return this },
        async maybeSingle() {
          calls.push(['superClientLookup'])
          return { data: superClient, error: superClientError }
        },
      }
    },
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

test('without JWT is rejected before any user client is created', async () => {
  let created = false
  await expectCode(authorizeConfigRequest({
    authorization: null,
    requestedClienteId: CLIENT_A,
    createUserClient: () => { created = true },
  }), 'AUTH_REQUIRED', 401)
  assert.equal(created, false)
})

test('inactive profiles and staff cannot use ap-config', async () => {
  await expectCode(authorizeConfigRequest({
    authorization: 'Bearer signed',
    requestedClienteId: CLIENT_A,
    createUserClient: () => client({ identity: { id: USER, ativo: false, access_ready: false, role: 'admin' } }),
  }), 'PROFILE_INACTIVE', 403)

  await expectCode(authorizeConfigRequest({
    authorization: 'Bearer signed',
    requestedClienteId: CLIENT_A,
    createUserClient: () => client({ identity: { id: USER, ativo: true, access_ready: true, role: 'staff' } }),
  }), 'CONFIG_ROLE_FORBIDDEN', 403)
})

test('an admin can use only an explicit client in its operational allowlist', async () => {
  const mock = client({ clients: [CLIENT_A, CLIENT_B] })
  const result = await authorizeConfigRequest({
    authorization: 'Bearer signed',
    requestedClienteId: CLIENT_B,
    createUserClient: () => mock,
  })
  assert.deepEqual(result, { userId: USER, role: 'admin', clienteId: CLIENT_B })

  await expectCode(authorizeConfigRequest({
    authorization: 'Bearer signed',
    requestedClienteId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    createUserClient: () => client({ clients: [CLIENT_A] }),
  }), 'TENANT_FORBIDDEN', 403)
})

test('zero clients fails closed and multiple clients require explicit selection', async () => {
  await expectCode(authorizeConfigRequest({
    authorization: 'Bearer signed',
    requestedClienteId: null,
    createUserClient: () => client({ clients: [] }),
  }), 'OPERATIONAL_CLIENT_NOT_FOUND', 403)

  await expectCode(authorizeConfigRequest({
    authorization: 'Bearer signed',
    requestedClienteId: null,
    createUserClient: () => client({
      clients: [CLIENT_A, CLIENT_B],
      resolverError: new Error('OPERATIONAL_CLIENT_SELECTION_REQUIRED'),
    }),
  }), 'OPERATIONAL_CLIENT_SELECTION_REQUIRED', 409)
})

test('one allowed client may be resolved only by the canonical fail-closed RPC', async () => {
  const mock = client({ clients: [CLIENT_A], resolver: CLIENT_A })
  const result = await authorizeConfigRequest({
    authorization: 'Bearer signed',
    requestedClienteId: undefined,
    createUserClient: () => mock,
  })
  assert.equal(result.clienteId, CLIENT_A)
  assert.deepEqual(mock.calls.slice(-1), [['rpc', 'require_single_operational_cliente_id']])
  assert.ok(!mock.calls.some(([, name]) => name === 'get_my_cliente_id'))
})

test('super admin must name an active client and never receives a fallback', async () => {
  await expectCode(authorizeConfigRequest({
    authorization: 'Bearer signed',
    requestedClienteId: null,
    createUserClient: () => client({ identity: { id: USER, ativo: true, access_ready: true, role: 'super_admin' } }),
  }), 'OPERATIONAL_CLIENT_SELECTION_REQUIRED', 409)

  await expectCode(authorizeConfigRequest({
    authorization: 'Bearer signed',
    requestedClienteId: CLIENT_A,
    createUserClient: () => client({
      identity: { id: USER, ativo: true, access_ready: true, role: 'super_admin' },
      superClient: null,
    }),
  }), 'TENANT_FORBIDDEN', 403)

  const result = await authorizeConfigRequest({
    authorization: 'Bearer signed',
    requestedClienteId: CLIENT_A,
    createUserClient: () => client({
      identity: { id: USER, ativo: true, access_ready: true, role: 'super_admin' },
      superClient: { id: CLIENT_A },
    }),
  })
  assert.deepEqual(result, { userId: USER, role: 'super_admin', clienteId: CLIENT_A })
})

test('ap-config scopes every operation before service role and UI sends cliente_id', async () => {
  const root = new URL('../', import.meta.url)
  const source = await readFile(new URL('supabase/functions/ap-config/index.ts', root), 'utf8')
  const templates = await readFile(new URL('src/pages/admin/AutoPublisherTemplates.jsx', root), 'utf8')
  const settings = await readFile(new URL('src/pages/admin/AutoPublisherSettings.jsx', root), 'utf8')

  assert.doesNotMatch(source, /FIXED_CLIENT_ID|get_my_cliente_id/)
  assert.match(source, /await authorizeConfigRequest/)
  assert.ok(source.indexOf('await authorizeConfigRequest') < source.indexOf('SUPABASE_SERVICE_ROLE_KEY'))
  assert.match(source, /\.eq\(ownerColumn, authorization\.clienteId\)/)
  assert.match(source, /\.eq\("id", id\)[\s\S]*?\.eq\(ownerColumn, authorization\.clienteId\)/)
  assert.match(source, /\.delete\(\)[\s\S]*?\.eq\("id", id\)[\s\S]*?\.eq\(ownerColumn, authorization\.clienteId\)/)
  assert.match(source, /OWNER_SCOPE_MANAGED_BY_SERVER/)
  assert.match(source, /sources:.*cliente_id/s)
  assert.match(source, /patrocinadores:.*cliente_id/s)
  assert.match(source, /templates:.*empresa_id/s)
  assert.match(source, /template_sets:.*empresa_id/s)
  assert.match(templates, /cliente_id: clienteId/)
  assert.match(settings, /cliente_id: clienteId/)
})
