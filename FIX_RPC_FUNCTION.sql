-- Corrigir a função get_companies_stats para evitar erro 400
-- A função original estava tentando contar de empresa_profissionais que pode ter FK issues

CREATE OR REPLACE FUNCTION get_companies_stats()
RETURNS TABLE (
    empresa_id UUID,
    nome TEXT,
    status_conta TEXT,
    icp_status TEXT,
    tipo_negocio TEXT,
    users_count BIGINT,
    active_tasks_count BIGINT,
    last_activity_at TIMESTAMP WITH TIME ZONE,
    health_status TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        e.id,
        e.nome,
        COALESCE(e.status_conta, 'active') as status_conta,
        COALESCE(e.icp_status, 'doubtful') as icp_status,
        COALESCE(e.tipo_negocio, 'other') as tipo_negocio,
        COALESCE((
            SELECT COUNT(DISTINCT p.id)
            FROM profissionais p
            WHERE p.empresa_id = e.id
        ), 0) as users_count,
        COALESCE((
            SELECT COUNT(*) 
            FROM tarefas t 
            WHERE t.empresa_id = e.id 
            AND t.status IN ('pendente', 'em_progresso')
        ), 0) as active_tasks_count,
        COALESCE(e.last_activity_at, e.created_at) as last_activity_at,
        CASE
            WHEN COALESCE(e.last_activity_at, e.created_at) > NOW() - INTERVAL '7 days' THEN 'healthy'
            WHEN COALESCE(e.last_activity_at, e.created_at) > NOW() - INTERVAL '14 days' THEN 'low_activity'
            ELSE 'inactive'
        END as health_status
    FROM empresas e
    ORDER BY e.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
