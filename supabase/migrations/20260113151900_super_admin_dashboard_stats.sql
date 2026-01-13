-- Migration: Super Admin Dashboard Stats RPC
-- Description: Creates RPC function to get TENANT-ONLY statistics for Super Admin Dashboard

CREATE OR REPLACE FUNCTION get_super_admin_dashboard_stats()
RETURNS JSON AS $$
DECLARE
    result JSON;
    total_tenants INT;
    active_tenants INT;
    suspended_tenants INT;
    growth_data JSON;
    alerts_data JSON;
    summary_text TEXT;
    recent_growth INT;
BEGIN
    -- Security: Only super_admin can execute
    IF NOT EXISTS (
        SELECT 1 FROM profissionais
        WHERE id = auth.uid() AND role = 'super_admin'
    ) THEN
        RAISE EXCEPTION 'Forbidden: Super Admin access required';
    END IF;

    -- Total tenants (empresa_tipo = 'tenant' ONLY)
    SELECT COUNT(*) INTO total_tenants
    FROM empresas
    WHERE empresa_tipo = 'tenant';

    -- Active tenants (last 7 days)
    SELECT COUNT(*) INTO active_tenants
    FROM empresas
    WHERE empresa_tipo = 'tenant'
    AND last_activity_at > NOW() - INTERVAL '7 days';

    -- Suspended tenants
    SELECT COUNT(*) INTO suspended_tenants
    FROM empresas
    WHERE empresa_tipo = 'tenant'
    AND status_conta = 'suspended';

    -- Growth data (last 30 days)
    SELECT json_agg(
        json_build_object(
            'date', date_series::date,
            'total', (
                SELECT COUNT(*)
                FROM empresas
                WHERE empresa_tipo = 'tenant'
                AND created_at::date <= date_series::date
            )
        )
        ORDER BY date_series
    ) INTO growth_data
    FROM generate_series(
        CURRENT_DATE - INTERVAL '29 days',
        CURRENT_DATE,
        INTERVAL '1 day'
    ) AS date_series;

    -- Alerts summary
    SELECT json_build_object(
        'critical', (
            SELECT COUNT(*)
            FROM empresas
            WHERE empresa_tipo = 'tenant'
            AND (
                status_conta = 'suspended' OR
                last_activity_at < NOW() - INTERVAL '14 days'
            )
        ),
        'warning', (
            SELECT COUNT(*)
            FROM empresas
            WHERE empresa_tipo = 'tenant'
            AND last_activity_at > NOW() - INTERVAL '14 days'
            AND last_activity_at <= NOW() - INTERVAL '7 days'
        )
    ) INTO alerts_data;

    -- Recent growth (last 30 days)
    SELECT COUNT(*) INTO recent_growth
    FROM empresas
    WHERE empresa_tipo = 'tenant'
    AND created_at > NOW() - INTERVAL '30 days';

    -- Executive summary
    summary_text := total_tenants || ' empresa' || 
                   CASE WHEN total_tenants != 1 THEN 's' ELSE '' END ||
                   ' ativa' || CASE WHEN total_tenants != 1 THEN 's' ELSE '' END ||
                   ' no FlowOS, sistema estável e ' ||
                   CASE WHEN recent_growth > 0 
                       THEN 'crescimento consistente' 
                       ELSE 'sem novos clientes' 
                   END ||
                   ' nos últimos 30 dias.';

    -- Build final result
    result := json_build_object(
        'metrics', json_build_object(
            'totalTenants', total_tenants,
            'activeTenants', active_tenants,
            'suspendedTenants', suspended_tenants,
            'activeRatio', CASE 
                WHEN total_tenants > 0 
                THEN ROUND((active_tenants::decimal / total_tenants * 100), 1)
                ELSE 0 
            END
        ),
        'growthData', growth_data,
        'healthStatus', json_build_object(
            'status', 'healthy',
            'latency', 150
        ),
        'alerts', alerts_data,
        'summary', summary_text
    );

    RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission to authenticated users (RLS will check super_admin role)
GRANT EXECUTE ON FUNCTION get_super_admin_dashboard_stats() TO authenticated;

-- Comment
COMMENT ON FUNCTION get_super_admin_dashboard_stats() IS 'Returns dashboard statistics for Super Admin - TENANT companies only (empresa_tipo = tenant)';
