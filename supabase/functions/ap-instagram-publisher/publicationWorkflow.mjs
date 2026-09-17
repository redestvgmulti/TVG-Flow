/** Legacy single-account Feed only. Every irreversible boundary is persisted first. */
export class PublicationError extends Error {
  constructor(code) { super(code); this.name = 'PublicationError'; this.code = code }
}

export function validMediaId(value) {
  return typeof value === 'string' && /^[0-9]{1,100}$/.test(value)
}

export async function graphRequest(fetchImpl, url, body, timeoutMs = 15000) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: controller.signal,
    })
    const payload = await response.json().catch(() => null)
    if (!response.ok || payload?.error) {
      // Persist stable error codes only, never tokens, raw response bodies or URLs.
      const graphCode = Number.isInteger(payload?.error?.code) ? payload.error.code : 'UNKNOWN'
      throw new PublicationError(`GRAPH_HTTP_${response.status}_CODE_${graphCode}`)
    }
    if (!validMediaId(payload?.id)) throw new PublicationError('GRAPH_VALID_ID_REQUIRED')
    return payload.id
  } catch (error) {
    if (error instanceof PublicationError) throw error
    throw new PublicationError(controller.signal.aborted ? 'GRAPH_TIMEOUT' : 'GRAPH_TRANSPORT_ERROR')
  } finally { clearTimeout(timeout) }
}

export async function publishLegacyFeed({ store, candidateId, accountId, token, fetchImpl = fetch, timeoutMs = 15000 }) {
  if (!validMediaId(accountId) || !token) throw new PublicationError('INSTAGRAM_CONFIGURATION_REQUIRED')
  const claim = await store.claim(candidateId, accountId)
  if (!claim) return { outcome: 'not_claimed' }
  const attemptId = claim.attempt_id
  let containerId
  try {
    containerId = await graphRequest(fetchImpl, `https://graph.facebook.com/v22.0/${accountId}/media`, {
      image_url: claim.render_url, caption: claim.caption ?? '', access_token: token,
    }, timeoutMs)
  } catch (error) {
    // /media creates an unpublished container, so this failure can safely retry.
    await store.advance(attemptId, 'claimed', 'safe_failed', { errorCode: error.code })
    return { outcome: 'safe_failed', attemptId, error: error.code }
  }
  await store.advance(attemptId, 'claimed', 'container_created', { containerId })
  // If this write or its response fails, do not make the irreversible request.
  await store.advance(attemptId, 'container_created', 'publishing', {})
  let postId
  try {
    postId = await graphRequest(fetchImpl, `https://graph.facebook.com/v22.0/${accountId}/media_publish`, {
      creation_id: containerId, access_token: token,
    }, timeoutMs)
  } catch (error) {
    await store.advance(attemptId, 'publishing', 'reconciliation_required', { errorCode: error.code })
    return { outcome: 'reconciliation_required', attemptId, containerId, error: error.code }
  }
  try {
    // Separate durable evidence from the candidate update. Retrying finish never calls Graph.
    await store.advance(attemptId, 'publishing', 'confirmed', { externalId: postId })
    await store.finish(attemptId)
  } catch {
    // Even if persistence is unavailable, 'publishing' remains an exclusion barrier.
    return { outcome: 'reconciliation_required', attemptId, containerId, externalMediaId: postId, error: 'LOCAL_CONFIRMATION_FAILED' }
  }
  return { outcome: 'posted', attemptId, externalMediaId: postId }
}

export function supabasePublicationStore(supabase) {
  async function rpc(name, args) {
    const { data, error } = await supabase.schema('ap').rpc(name, args)
    if (error) throw new PublicationError(`DATABASE_${name.toUpperCase()}_FAILED`)
    return data
  }
  return {
    claim: (id, account) => rpc('p0_claim_publication', { p_candidate_id: id, p_account_id: account }),
    advance: (id, expected, next, fields) => rpc('p0_advance_publication', {
      p_attempt_id: id, p_expected_stage: expected, p_next_stage: next,
      p_container_id: fields.containerId ?? null, p_external_id: fields.externalId ?? null,
      p_error_code: fields.errorCode ?? null,
    }),
    finish: id => rpc('p0_finish_publication', { p_attempt_id: id }),
  }
}
