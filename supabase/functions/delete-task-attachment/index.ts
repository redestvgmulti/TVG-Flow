import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        // Create authenticated Supabase client
        const supabaseClient = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_ANON_KEY') ?? '',
            {
                global: {
                    headers: { Authorization: req.headers.get('Authorization')! },
                },
            }
        )

        // Get user from JWT
        const {
            data: { user },
            error: userError,
        } = await supabaseClient.auth.getUser()

        if (userError || !user) {
            return new Response(
                JSON.stringify({ error: 'Unauthorized' }),
                { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // Parse request body
        const { attachment_id } = await req.json()

        if (!attachment_id) {
            return new Response(
                JSON.stringify({ error: 'attachment_id is required' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // 1. FETCH attachment metadata (RLS will validate SELECT permission)
        const { data: attachment, error: fetchError } = await supabaseClient
            .from('task_attachments')
            .select('id, storage_path, uploaded_by, empresa_id')
            .eq('id', attachment_id)
            .single()

        if (fetchError || !attachment) {
            return new Response(
                JSON.stringify({ error: 'Attachment not found or access denied' }),
                { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // 2. VALIDATE DELETE permission and active tenant membership.
        const { data: callerAccess } = await supabaseClient
            .from('empresa_profissionais')
            .select('profissionais!inner(role, ativo)')
            .eq('profissional_id', user.id)
            .eq('empresa_id', attachment.empresa_id)
            .eq('ativo', true)
            .eq('profissionais.ativo', true)
            .maybeSingle()

        const canDelete = Boolean(callerAccess) && (
            attachment.uploaded_by === user.id ||
            callerAccess?.profissionais?.role === 'admin'
        )

        if (!canDelete) {
            return new Response(
                JSON.stringify({ error: 'Permission denied. Only owner or admin can delete.' }),
                { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // 3. DELETE from Database (SOURCE OF TRUTH)
        const { error: dbDeleteError } = await supabaseClient
            .from('task_attachments')
            .delete()
            .eq('id', attachment_id)

        if (dbDeleteError) {
            console.error('DB delete failed:', dbDeleteError)
            return new Response(
                JSON.stringify({ error: 'Failed to delete from database', details: dbDeleteError }),
                { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // 4. DELETE from Storage (PHYSICAL CLEANUP)
        // Use service role key to bypass storage RLS (since we already validated permission)
        const supabaseAdmin = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        )

        const { error: storageDeleteError } = await supabaseAdmin.storage
            .from('task-attachments')
            .remove([attachment.storage_path])

        if (storageDeleteError) {
            // Log but don't fail - DB is already clean (source of truth)
            console.warn('Storage cleanup failed (orphaned file):', storageDeleteError)
            // Consider adding to cleanup queue
        }

        // Success
        return new Response(
            JSON.stringify({
                success: true,
                message: 'Attachment deleted successfully',
                storage_cleanup: !storageDeleteError
            }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )

    } catch (error) {
        console.error('Unexpected error:', error)
        return new Response(
            JSON.stringify({ error: 'Internal server error', details: error.message }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    }
})
