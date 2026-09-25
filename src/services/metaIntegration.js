function resultData(result, fallback) {
  const code = result?.data?.error
  if (result?.error || code) throw new Error(code || result.error?.message || fallback)
  return result?.data
}

function tenantHeaders(clienteId) {
  return clienteId ? { 'x-ap-cliente-id': clienteId } : {}
}

export const META_OAUTH_PENDING_TENANT_KEY = 'meta-oauth-pending-tenant'

export async function getMetaConnectionStatus(supabase, clienteId) {
  const result = await supabase.functions.invoke('ap-meta-connection-status', { method: 'GET', headers: tenantHeaders(clienteId) })
  return resultData(result, 'META_STATUS_FAILED')
}

export async function startMetaConnection(supabase, clienteId) {
  const result = await supabase.functions.invoke('ap-meta-oauth-start', { method: 'POST', headers: tenantHeaders(clienteId) })
  const data = resultData(result, 'META_OAUTH_START_FAILED')
  if (!/^https:\/\/www\.facebook\.com\//.test(data?.authorize_url || '')) throw new Error('META_AUTHORIZE_URL_INVALID')
  if (clienteId) window.sessionStorage.setItem(META_OAUTH_PENDING_TENANT_KEY, clienteId)
  else window.sessionStorage.removeItem(META_OAUTH_PENDING_TENANT_KEY)
  return data.authorize_url
}

export async function selectMetaConnection(supabase, clienteId, candidateId) {
  const result = await supabase.functions.invoke('ap-meta-oauth-select', {
    method: 'POST', body: { candidate_id: candidateId }, headers: tenantHeaders(clienteId),
  })
  return resultData(result, 'META_SELECTION_FAILED')
}

export async function disconnectMetaConnection(supabase, clienteId) {
  const result = await supabase.functions.invoke('ap-meta-disconnect', { method: 'POST', headers: tenantHeaders(clienteId) })
  return resultData(result, 'META_DISCONNECT_FAILED')
}
