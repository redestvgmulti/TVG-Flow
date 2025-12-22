import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        // HARDENING: Use service_role for system checks
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

        // Check system integrity
        const { data: integrityData, error: integrityError } = await supabaseClient
            .rpc('check_system_integrity')

        if (integrityError) {
            throw new Error(`Integrity check failed: ${integrityError.message}`)
        }

        const integrity = integrityData?.[0]

        // Check data integrity
        const { data: dataChecks, error: dataError } = await supabaseClient
            .rpc('check_data_integrity')

        if (dataError) {
            throw new Error(`Data integrity check failed: ${dataError.message}`)
        }

        // Production checklist
        const { data: checklist, error: checklistError } = await supabaseClient
            .rpc('production_checklist')

        if (checklistError) {
            throw new Error(`Checklist failed: ${checklistError.message}`)
        }

        // HARDENING: Never return stacktrace, only controlled errors
        const response = {
            system_integrity: {
                status: integrity?.status || 'UNKNOWN',
                message: integrity?.message || 'Unable to determine system status',
                issues: {
                    missing_migrations: integrity?.missing_migrations || [],
                    missing_tables: integrity?.missing_tables || [],
                    missing_triggers: integrity?.missing_triggers || [],
                    missing_constraints: integrity?.missing_constraints || [],
                    rls_issues: integrity?.rls_issues || []
                }
            },
            data_integrity: dataChecks || [],
            production_checklist: checklist || [],
            timestamp: new Date().toISOString()
        }

        return new Response(
            JSON.stringify(response),
            {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: integrity?.status === 'OK' ? 200 : 500
            }
        )

    } catch (error) {
        // HARDENING: Never expose internal errors to frontend
        console.error('System check error:', error)

        return new Response(
            JSON.stringify({
                error: 'System validation failed',
                message: 'Unable to complete system integrity check. Contact technical administrator.',
                timestamp: new Date().toISOString()
            }),
            {
                status: 500,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            }
        )
    }
})
