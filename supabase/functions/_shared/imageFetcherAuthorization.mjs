const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export class ImageFetcherAuthorizationError extends Error {
  constructor(code, status) {
    super(code)
    this.name = 'ImageFetcherAuthorizationError'
    this.code = code
    this.status = status
  }
}

export async function authorizeImageFetcherRequest({
  body,
  internalRequest,
  requireOperator,
  loadCandidate,
  authorizeTenant,
}) {
  const payload = body && typeof body === 'object' && !Array.isArray(body) ? body : {}
  const acceptedKeys = new Set(['candidate_id'])
  if (Object.keys(payload).some((key) => !acceptedKeys.has(key))) {
    throw new ImageFetcherAuthorizationError('UNTRUSTED_INPUT', 400)
  }

  const candidateId = payload.candidate_id
  if (candidateId !== undefined && (typeof candidateId !== 'string' || !UUID_PATTERN.test(candidateId))) {
    throw new ImageFetcherAuthorizationError('INVALID_CANDIDATE_ID', 400)
  }

  if (internalRequest) {
    if (!candidateId) return { mode: 'internal_batch', candidate: null, operator: null }
    const candidate = await loadCandidate(candidateId)
    if (!candidate) throw new ImageFetcherAuthorizationError('CANDIDATE_NOT_FOUND', 404)
    return { mode: 'internal_target', candidate, operator: null }
  }

  if (!candidateId) {
    throw new ImageFetcherAuthorizationError('CANDIDATE_ID_REQUIRED', 400)
  }

  let operator
  try {
    operator = await requireOperator(['admin', 'staff'])
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    const status = message.startsWith('UNAUTHORIZED') ? 401 : 403
    throw new ImageFetcherAuthorizationError(status === 401 ? 'AUTH_REQUIRED' : 'OPERATOR_FORBIDDEN', status)
  }

  const candidate = await loadCandidate(candidateId)
  if (!candidate) throw new ImageFetcherAuthorizationError('CANDIDATE_NOT_FOUND', 404)
  try {
    await authorizeTenant(candidate.cliente_id)
  } catch {
    throw new ImageFetcherAuthorizationError('TENANT_FORBIDDEN', 403)
  }
  return { mode: 'operator_target', candidate, operator }
}
