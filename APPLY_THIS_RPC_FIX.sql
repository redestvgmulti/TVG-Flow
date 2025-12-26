-- CORREÇÃO DEFINITIVA: get_companies_stats
-- DROP antes de CREATE para permitir mudança de assinatura

DROP FUNCTION IF EXISTS get_companies_stats();

CREATE FUNCTION get_companies_stats()
RETURNS TABLE (
    empresa_id UUID,
    nome TEXT,
    cnpj TEXT,
    status_conta TEXT,
    icp_status TEXT,
    tipo_negocio TEXT,
    users_count BIGINT,
    admins_count BIGINT,
    active_tasks_count BIGINT,
    last_activity_at TIMESTAMP WITH TIME ZONE,
    health_status TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        e.id,
        e.nome,
        e.cnpj,
        COALESCE(e.status_conta, 'active') as status_conta,
        COALESCE(e.icp_status, 'doubtful') as icp_status,
        COALESCE(e.tipo_negocio, 'other') as tipo_negocio,
        -- Total de usuários via junction table
        COALESCE((
            SELECT COUNT(DISTINCT ep.profissional_id)
            FROM empresa_profissionais ep
            WHERE ep.empresa_id = e.id
        ), 0) as users_count,
        -- Admins via junction + role check
        COALESCE((
            SELECT COUNT(DISTINCT ep.profissional_id)
            FROM empresa_profissionais ep
            JOIN profissionais p ON p.id = ep.profissional_id
            WHERE ep.empresa_id = e.id AND p.role = 'admin'
        ), 0) as admins_count,
        -- Tarefas ativas
        COALESCE((
            SELECT COUNT(*) 
            FROM tarefas t 
            WHERE t.empresa_id = e.id 
            AND t.status IN ('pendente', 'em_progresso')
        ), 0) as active_tasks_count,
        COALESCE(e.last_activity_at, e.created_at) as last_activity_at,
        CASE
            WHEN COALESCE(e.last_activity_at, e.created_at) > NOW() - INTERVAL '14 days' THEN 'low_activity'
            WHEN COALESCE(e.last_activity_at, e.created_at) > NOW() - INTERVAL '7 days' THEN 'healthy'
            ELSE 'inactive'
        END as health_status
    FROM empresas e
    ORDER BY e.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
