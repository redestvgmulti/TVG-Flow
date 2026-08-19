import assert from 'node:assert/strict'
import test from 'node:test'
import {
  authorizeImageFetcherRequest,
  ImageFetcherAuthorizationError,
} from '../supabase/functions/_shared/imageFetcherAuthorization.mjs'

const candidateId = '11111111-1111-4111-8111-111111111111'
const clienteId = '22222222-2222-4222-8222-222222222222'
const candidate = { id: candidateId, cliente_id: clienteId, status: 'raw' }

async function expectAuthError(options, code, status) {
  await assert.rejects(
    authorizeImageFetcherRequest(options),
    (error) => error instanceof ImageFetcherAuthorizationError && error.code === code && error.status === status,
  )
}

function base(overrides = {}) {
  return {
    body: { candidate_id: candidateId },
    internalRequest: false,
    requireOperator: async () => ({ id: 'user', role: 'staff' }),
    loadCandidate: async () => candidate,
    authorizeTenant: async () => ({ clienteId }),
    ...overrides,
  }
}

test('allows a trusted service worker batch without caller-controlled target data', async () => {
  const result = await authorizeImageFetcherRequest(base({ body: {}, internalRequest: true }))
  assert.equal(result.mode, 'internal_batch')
})

test('allows a trusted service worker to target an existing candidate', async () => {
  const result = await authorizeImageFetcherRequest(base({ internalRequest: true }))
  assert.equal(result.mode, 'internal_target')
  assert.equal(result.candidate.id, candidateId)
})

test('fails closed without authentication', async () => {
  await expectAuthError(base({ requireOperator: async () => { throw new Error('UNAUTHORIZED: Missing bearer token.') } }), 'AUTH_REQUIRED', 401)
})

test('fails closed for an invalid JWT', async () => {
  await expectAuthError(base({ requireOperator: async () => { throw new Error('UNAUTHORIZED: Invalid token.') } }), 'AUTH_REQUIRED', 401)
})

test('fails closed for an inactive or suspended operator', async () => {
  await expectAuthError(base({ requireOperator: async () => { throw new Error('FORBIDDEN: inactive profile') } }), 'OPERATOR_FORBIDDEN', 403)
})

for (const role of ['staff', 'admin']) {
  test(`allows an active ${role} for an authorized tenant candidate`, async () => {
    const result = await authorizeImageFetcherRequest(base({
      requireOperator: async (roles) => {
        assert.ok(roles.includes(role))
        return { id: 'user', role }
      },
    }))
    assert.equal(result.mode, 'operator_target')
    assert.equal(result.operator.role, role)
  })
}

test('fails closed for a candidate from another tenant', async () => {
  await expectAuthError(base({ authorizeTenant: async () => { throw new Error('TENANT_FORBIDDEN') } }), 'TENANT_FORBIDDEN', 403)
})

test('fails closed for a nonexistent candidate', async () => {
  await expectAuthError(base({ loadCandidate: async () => null }), 'CANDIDATE_NOT_FOUND', 404)
})

test('rejects caller-controlled cliente_id and URL fields', async () => {
  await expectAuthError(base({ body: { candidate_id: candidateId, cliente_id: clienteId, url: 'https://example.com' } }), 'UNTRUSTED_INPUT', 400)
})

test('requires a candidate target for interactive execution', async () => {
  await expectAuthError(base({ body: {} }), 'CANDIDATE_ID_REQUIRED', 400)
})
