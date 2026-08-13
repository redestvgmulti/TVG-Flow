import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  authorizeOperationalTenant,
  TenantAuthorizationError,
} from '../../supabase/functions/ap-employee-generator/tenantAuthorization.ts'

const USER = '11111111-1111-4111-8111-111111111111'
const OTHER_USER = '22222222-2222-4222-8222-222222222222'
const CLIENT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const CLIENT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const CLIENT_C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

function client({
  user = { id: USER },
  userError = null,
  clients = [CLIENT_A],
  clientsError = null,
  agency = null,
  agencyError = null,
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
    schema(name) {
      assert.equal(name, 'ap')
      return {
        async rpc(functionName) {
          calls.push(['schemaRpc', functionName])
          assert.equal(functionName, 'get_operational_cliente_ids')
          return {
            data: clients.map(cliente_id => ({ cliente_id })),
            error: clientsError,
          }
        },
      }
    },
    async rpc(functionName) {
      calls.push(['rpc', functionName])
      assert.equal(functionName, 'get_agencia_cliente_id')
      return { data: agency, error: agencyError }
    },
  }
}

function factory(mockClient) {
  const tokens = []
  return {
    tokens,
    createUserClient(token) {
      tokens.push(token)
      return mockClient
    },
  }
}

async function expectCode(promise, code, status) {
  await assert.rejects(promise, error => {
    assert.ok(error instanceof TenantAuthorizationError)
    assert.equal(error.code, code)
    assert.equal(error.status, status)
    return true
  })
}

test('AUTH_REQUIRED rejects a request before a Supabase client is created', async () => {
  const mock = client()
  const userFactory = factory(mock)
  await expectCode(authorizeOperationalTenant({
    authorization: null,
    requestedClienteId: CLIENT_A,
    requestedAuthUserId: USER,
    createUserClient: userFactory.createUserClient,
  }), 'AUTH_REQUIRED', 401)
  assert.deepEqual(userFactory.tokens, [])
  assert.deepEqual(mock.calls, [])
})

test('AUTH_INVALID rejects an invalid token', async () => {
  const mock = client({ user: null, userError: new Error('invalid token') })
  await expectCode(authorizeOperationalTenant({
    authorization: 'Bearer invalid',
    requestedClienteId: CLIENT_A,
    requestedAuthUserId: null,
    createUserClient: () => mock,
  }), 'AUTH_INVALID', 401)
  assert.deepEqual(mock.calls, [['getUser', 'invalid']])
})

test('a valid caller can select an explicitly authorized client', async () => {
  const mock = client({ clients: [CLIENT_A, CLIENT_B] })
  const result = await authorizeOperationalTenant({
    authorization: 'Bearer signed-token',
    requestedClienteId: CLIENT_B,
    requestedAuthUserId: USER,
    createUserClient: () => mock,
  })
  assert.deepEqual(result, { clienteId: CLIENT_B, userId: USER })
  assert.deepEqual(mock.calls, [
    ['getUser', 'signed-token'],
    ['schemaRpc', 'get_operational_cliente_ids'],
  ])
})

test('TENANT_FORBIDDEN does not reveal a foreign client', async () => {
  const mock = client({ clients: [CLIENT_A] })
  await expectCode(authorizeOperationalTenant({
    authorization: 'Bearer signed-token',
    requestedClienteId: CLIENT_C,
    requestedAuthUserId: USER,
    createUserClient: () => mock,
  }), 'TENANT_FORBIDDEN', 403)
})

test('AUTH_USER_MISMATCH rejects body identity that differs from the token', async () => {
  const mock = client()
  await expectCode(authorizeOperationalTenant({
    authorization: 'Bearer signed-token',
    requestedClienteId: CLIENT_A,
    requestedAuthUserId: OTHER_USER,
    createUserClient: () => mock,
  }), 'AUTH_USER_MISMATCH', 403)
  assert.deepEqual(mock.calls, [['getUser', 'signed-token']])
})

test('a single authorized client is selected when cliente_id is absent', async () => {
  const mock = client({ clients: [CLIENT_A] })
  const result = await authorizeOperationalTenant({
    authorization: 'Bearer signed-token',
    requestedClienteId: null,
    requestedAuthUserId: null,
    createUserClient: () => mock,
  })
  assert.equal(result.clienteId, CLIENT_A)
})

test('the agency resolver is only a preference inside a multi-client allowlist', async () => {
  const mock = client({
    clients: [CLIENT_A, CLIENT_B],
    agency: CLIENT_B,
  })
  const result = await authorizeOperationalTenant({
    authorization: 'Bearer signed-token',
    requestedClienteId: null,
    requestedAuthUserId: USER,
    createUserClient: () => mock,
  })
  assert.equal(result.clienteId, CLIENT_B)
  assert.deepEqual(mock.calls.at(-1), ['rpc', 'get_agencia_cliente_id'])
})

test('an agency outside the caller allowlist cannot authorize a tenant', async () => {
  const mock = client({
    clients: [CLIENT_A, CLIENT_B],
    agency: CLIENT_C,
  })
  await expectCode(authorizeOperationalTenant({
    authorization: 'Bearer signed-token',
    requestedClienteId: null,
    requestedAuthUserId: USER,
    createUserClient: () => mock,
  }), 'TENANT_NOT_FOUND', 403)
})

test('no active client membership is rejected', async () => {
  const mock = client({ clients: [] })
  await expectCode(authorizeOperationalTenant({
    authorization: 'Bearer signed-token',
    requestedClienteId: null,
    requestedAuthUserId: USER,
    createUserClient: () => mock,
  }), 'TENANT_NOT_FOUND', 403)
})

test('generator creates service role only after authorization and uses token identity', async () => {
  const source = await readFile(
    new URL('../../supabase/functions/ap-employee-generator/index.ts', import.meta.url),
    'utf8',
  )
  const authorizationCall = source.indexOf('await authorizeOperationalTenant')
  const serviceRoleClient = source.search(/Deno\.env\.get\(['"]SUPABASE_SERVICE_ROLE_KEY['"]\)/)
  assert.ok(authorizationCall >= 0)
  assert.ok(serviceRoleClient > authorizationCall)
  assert.match(source, /p_auth_user_id:\s*authenticatedUserId/)
  assert.doesNotMatch(source, /p_auth_user_id:\s*isUUID\(auth_user_id\)/)
})
