import { normalizeInstagramProfile } from '../../supabase/functions/_shared/social/instagramProfile.mjs'

export class InstagramRadarError extends Error {
  constructor(code) {
    super(code)
    this.code = code
  }
}

async function authenticatedHeaders(supabase) {
  const { data, error } = await supabase.auth.getSession()
  if (error || !data?.session?.access_token) throw new InstagramRadarError('AUTH_SESSION_UNAVAILABLE')
  return { Authorization: `Bearer ${data.session.access_token}` }
}

async function requestInstagramSources(supabase, clienteId, action, payload) {
  const headers = await authenticatedHeaders(supabase)
  const { data, error } = await supabase.functions.invoke('ap-config', {
    method: 'POST',
    headers,
    body: {
      resource: 'instagram_sources',
      action,
      cliente_id: clienteId,
      ...(payload ? { payload } : {}),
    },
  })
  const code = data?.error || error?.message
  if (code) throw new InstagramRadarError(code)
  return data
}

export async function listInstagramSources(supabase, clienteId) {
  return requestInstagramSources(supabase, clienteId, 'list')
}

export async function createInstagramSource(supabase, clienteId, input) {
  const profile = normalizeInstagramProfile(input)
  return requestInstagramSources(supabase, clienteId, 'insert', { input: profile.url })
}

export async function setInstagramSourceActive(supabase, clienteId, id, ativo) {
  return requestInstagramSources(supabase, clienteId, 'update', { id, ativo })
}

export async function removeInstagramSource(supabase, clienteId, id) {
  return requestInstagramSources(supabase, clienteId, 'delete', { id })
}

export { normalizeInstagramProfile }
