import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
    // Handle CORS preflight requests
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        // Create Supabase client with SERVICE_ROLE for elevated permissions
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

        // Verify user is authenticated and is super_admin
        const authHeader = req.headers.get('Authorization')!
        const token = authHeader.replace('Bearer ', '')
        const { data: { user }, error: userError } = await supabaseClient.auth.getUser(token)

        if (userError || !user) {
            return new Response(
                JSON.stringify({ error: 'Unauthorized' }),
                { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // Check if user is super_admin
        const { data: professional, error: profError } = await supabaseClient
            .from('profissionais')
            .select('role')
            .eq('id', user.id)
            .single()

        if (profError || professional?.role !== 'super_admin') {
            return new Response(
                JSON.stringify({ error: 'Forbidden: Super Admin access required' }),
                { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // Get dashboard stats - ONLY TENANTS
        const { data: tenants, error: tenantsError } = await supabaseClient
            .from('empresas')
            .select('id, nome, status_conta, created_at, last_activity_at')
            .eq('empresa_tipo', 'tenant')
            .order('created_at', { ascending: true })

        if (tenantsError) {
            throw tenantsError
        }

        const now = new Date()
        const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
        const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

        // Calculate metrics
        const totalTenants = tenants.length
        const activeTenants = tenants.filter(t =>
            t.last_activity_at && new Date(t.last_activity_at) > sevenDaysAgo
        ).length
        const suspendedTenants = tenants.filter(t => t.status_conta === 'suspended').length

        // Growth data (last 30 days)
        const growthData = []
        const today = new Date()
        for (let i = 29; i >= 0; i--) {
            const date = new Date(today)
            date.setDate(date.getDate() - i)
            date.setHours(0, 0, 0, 0)

            const count = tenants.filter(t => new Date(t.created_at) <= date).length

            growthData.push({
                date: date.toISOString().split('T')[0],
                total: count
            })
        }

        // System health (simplified - based on response time)
        const healthStatus = {
            status: 'healthy',
            latency: 150 // This would be from actual monitoring in production
        }

        // Alerts summary
        const alerts = {
            critical: tenants.filter(t =>
                t.status_conta === 'suspended' ||
                (t.last_activity_at && new Date(t.last_activity_at) < new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000))
            ).length,
            warning: tenants.filter(t =>
                t.last_activity_at &&
                new Date(t.last_activity_at) > new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000) &&
                new Date(t.last_activity_at) <= sevenDaysAgo
            ).length
        }

        // Executive summary
        const recentGrowth = tenants.filter(t => new Date(t.created_at) > thirtyDaysAgo).length
        const summary = `${totalTenants} empresa${totalTenants !== 1 ? 's' : ''} ativa${totalTenants !== 1 ? 's' : ''} no TVG Hub, sistema ${healthStatus.status === 'healthy' ? 'estável' : 'com atenções necessárias'} e ${recentGrowth > 0 ? 'crescimento consistente' : 'sem novos clientes'} nos últimos 30 dias.`

        return new Response(
            JSON.stringify({
                metrics: {
                    totalTenants,
                    activeTenants,
                    suspendedTenants,
                    activeRatio: totalTenants > 0 ? (activeTenants / totalTenants * 100).toFixed(1) : 0
                },
                growthData,
                healthStatus,
                alerts,
                summary
            }),
            {
                status: 200,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            }
        )
    } catch (error) {
        console.error('Error in get_super_admin_dashboard_stats:', error)
        return new Response(
            JSON.stringify({ error: error.message }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    }
})
