import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

export type CanonicalRole = 'super_admin' | 'admin' | 'staff'

export interface ActiveOperator {
  id: string
  email: string
  role: CanonicalRole
  tenantIds: string[]
}

export function createAdminClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

  if (!url || !serviceRoleKey) {
    throw new Error('SERVER_CONFIGURATION_ERROR')
  }

  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  })
}

export async function requireActiveOperator(
  req: Request,
  supabaseAdmin: SupabaseClient,
  allowedRoles: CanonicalRole[] = ['super_admin', 'admin']
): Promise<ActiveOperator> {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    throw new Error('UNAUTHORIZED: Missing bearer token.')
  }

  const token = authHeader.slice('Bearer '.length)
  const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token)

  if (userError || !user?.id || !user.email) {
    throw new Error('UNAUTHORIZED: Invalid token.')
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from('profissionais')
    .select('id, email, role, ativo')
    .eq('id', user.id)
    .maybeSingle()

  if (profileError || !profile || profile.ativo !== true) {
    throw new Error('FORBIDDEN: The requester does not have an active profile.')
  }

  if (!['super_admin', 'admin', 'staff'].includes(profile.role)) {
    throw new Error('FORBIDDEN: The requester has an invalid role.')
  }

  if (!allowedRoles.includes(profile.role as CanonicalRole)) {
    throw new Error('FORBIDDEN: The requester role cannot perform this operation.')
  }

  const { data: tenantLinks, error: tenantError } = await supabaseAdmin
    .from('empresa_profissionais')
    .select('empresa_id, empresas!inner(id, empresa_tipo, ativo)')
    .eq('profissional_id', user.id)
    .eq('ativo', true)
    .eq('empresas.empresa_tipo', 'tenant')
    .eq('empresas.ativo', true)

  if (tenantError) throw tenantError

  const tenantIds = [...new Set((tenantLinks ?? []).map((link: { empresa_id: string }) => link.empresa_id))]

  if (profile.role !== 'super_admin' && tenantIds.length !== 1) {
    throw new Error('FORBIDDEN: The requester must have exactly one active tenant.')
  }

  if (profile.role === 'super_admin' && tenantIds.length !== 0) {
    throw new Error('FORBIDDEN: A super administrator cannot have tenant membership.')
  }

  return {
    id: user.id,
    email: user.email.toLowerCase(),
    role: profile.role as CanonicalRole,
    tenantIds
  }
}

export function normalizeRequestedRole(value: unknown): 'admin' | 'staff' {
  if (value === 'admin') return 'admin'
  if (value === undefined || value === null || value === 'staff' || value === 'profissional') {
    return 'staff'
  }

  throw new Error('INVALID_ROLE: Only admin and staff are accepted.')
}

export function normalizeEmail(value: unknown): string {
  if (typeof value !== 'string') throw new Error('INVALID_EMAIL')
  const email = value.trim().toLowerCase()
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('INVALID_EMAIL')
  return email
}

export function normalizeName(value: unknown): string {
  if (typeof value !== 'string') throw new Error('INVALID_NAME')
  const name = value.trim().replace(/\s+/g, ' ')
  if (name.length < 2 || name.length > 160) throw new Error('INVALID_NAME')
  return name
}
