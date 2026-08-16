import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { createAdminClient, requireActiveOperator } from '../_shared/operatorAuth.ts'

const ALLOWED_UPDATE_KEYS = new Set(['nome', 'area_id', 'role'])

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    if (req.method !== 'POST') throw new Error('METHOD_NOT_ALLOWED')

    const supabaseAdmin = createAdminClient()
    const operator = await requireActiveOperator(req, supabaseAdmin)
    const { professional_id, payload } = await req.json()

    if (typeof professional_id !== 'string' || !professional_id) {
      throw new Error('PROFESSIONAL_ID_REQUIRED')
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('INVALID_UPDATE_PAYLOAD')
    }

    const unexpectedKeys = Object.keys(payload).filter((key) => !ALLOWED_UPDATE_KEYS.has(key))
    if (unexpectedKeys.length > 0) {
      throw new Error(`FORBIDDEN_FIELDS: ${unexpectedKeys.join(', ')}`)
    }

    if (operator.role !== 'super_admin' && Object.hasOwn(payload, 'role')) {
      throw new Error('ROLE_SCOPE_FORBIDDEN: Only a super administrator may change roles.')
    }

    const { data, error } = await supabaseAdmin.rpc('update_professional_identity', {
      p_actor_id: operator.id,
      p_professional_id: professional_id,
      p_updates: payload
    })

    if (error) throw error

    return new Response(JSON.stringify({ success: true, data }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  } catch (error) {
    const err = error as Error
    console.error('[update-professional]', err.message)
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: err.message.startsWith('UNAUTHORIZED') ? 401 : 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
