export class InternalWorkerAuthorizationError extends Error {
  constructor() {
    super("INTERNAL_WORKER_AUTH_REQUIRED")
    this.name = "InternalWorkerAuthorizationError"
  }
}

function constantTimeEqual(expected: string, actual: string | null) {
  if (!actual) return false
  let mismatch = expected.length ^ actual.length
  const length = Math.max(expected.length, actual.length)
  for (let index = 0; index < length; index += 1) {
    mismatch |= (expected.charCodeAt(index) || 0) ^ (actual.charCodeAt(index) || 0)
  }
  return mismatch === 0
}

export function isTrustedInternalRequest(req: Request) {
  const expected = Deno.env.get("AP_INTERNAL_WORKER_SECRET")
  if (!expected) return false
  return constantTimeEqual(expected, req.headers.get("x-ap-internal-secret"))
}

export function requireTrustedInternalRequest(req: Request) {
  if (!isTrustedInternalRequest(req)) throw new InternalWorkerAuthorizationError()
}
