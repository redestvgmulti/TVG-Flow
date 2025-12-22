import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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
        const supabaseClient = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
            {
                auth: {
                    autoRefreshToken: false,
                    persistSession: false
                }
            }
        )

        const { tarefa_id, profissional_ids, empresa_id } = await req.json()

        // Validate input
        if (!tarefa_id || !Array.isArray(profissional_ids) || profissional_ids.length === 0) {
            return new Response(
                JSON.stringify({ error: 'tarefa_id and profissional_ids array are required' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // If empresa_id is provided, validate that all professionals belong to that company
        if (empresa_id) {
            const { data: validProfessionals, error: validationError } = await supabaseClient
                .from('empresa_profissionais')
                .select('profissional_id')
                .eq('empresa_id', empresa_id)
                .in('profissional_id', profissional_ids)

            if (validationError) {
                throw validationError
            }

            const validProfessionalIds = validProfessionals.map(p => p.profissional_id)
            const invalidProfessionals = profissional_ids.filter(id => !validProfessionalIds.includes(id))

            if (invalidProfessionals.length > 0) {
                return new Response(
                    JSON.stringify({
                        error: 'Some professionals are not associated with this company',
                        invalid_professionals: invalidProfessionals
                    }),
                    { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                )
            }
        }

        // Create micro-tasks
        const microTasks = profissional_ids.map(profissional_id => ({
            tarefa_id,
            profissional_id,
            status: 'pendente'
        }))

        const { data, error } = await supabaseClient
            .from('tarefas_itens')
            .insert(microTasks)
            .select()

        if (error) {
            throw error
        }

        return new Response(
            JSON.stringify({
                success: true,
                created_count: data.length,
                micro_tasks: data
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )

    } catch (error) {
        return new Response(
            JSON.stringify({ error: error.message }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    }
})
