-- ========================================
-- SUPER ADMIN SETUP - EXECUÇÃO COMPLETA
-- ========================================
-- Execute este arquivo INTEIRO de uma vez no Supabase SQL Editor

-- PASSO 1: Corrigir RPC get_companies_stats
-- ==========================================
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
        COALESCE((
            SELECT COUNT(DISTINCT ep.profissional_id)
            FROM empresa_profissionais ep
            WHERE ep.empresa_id = e.id
        ), 0) as users_count,
        COALESCE((
            SELECT COUNT(DISTINCT ep.profissional_id)
            FROM empresa_profissionais ep
            JOIN profissionais p ON p.id = ep.profissional_id
            WHERE ep.empresa_id = e.id AND p.role = 'admin'
        ), 0) as admins_count,
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

-- PASSO 2: Criar empresa TVG Multi
-- ==================================
INSERT INTO empresas (id, nome, cnpj, status_conta, tipo_negocio, created_at, updated_at)
VALUES (
    '00000000-0000-0000-0000-000000000001',
    'TVG Multi',
    '00.000.000/0001-00',
    'active',
    'agency',
    NOW(),
    NOW()
)
ON CONFLICT (id) DO UPDATE SET
    nome = 'TVG Multi',
    status_conta = 'active',
    updated_at = NOW();

-- PASSO 3: Vincular todos os profissionais à TVG Multi
-- =====================================================
INSERT INTO empresa_profissionais (empresa_id, profissional_id, funcao, created_at)
SELECT 
    '00000000-0000-0000-0000-000000000001',
    p.id,
    CASE 
        WHEN p.role IN ('admin', 'super_admin') THEN 'gestor'
        ELSE 'membro'
    END as funcao,
    NOW()
FROM profissionais p
WHERE NOT EXISTS (
    SELECT 1 FROM empresa_profissionais ep 
    WHERE ep.profissional_id = p.id 
    AND ep.empresa_id = '00000000-0000-0000-0000-000000000001'
);

-- PASSO 4: Verificar resultado
-- =============================
SELECT 
    e.nome as empresa,
    e.status_conta,
    COUNT(ep.profissional_id) as total_profissionais,
    COUNT(CASE WHEN p.role = 'admin' THEN 1 END) as admins,
    COUNT(CASE WHEN p.role = 'professional' THEN 1 END) as professionals,
    COUNT(CASE WHEN p.role = 'super_admin' THEN 1 END) as super_admins
FROM empresas e
LEFT JOIN empresa_profissionais ep ON ep.empresa_id = e.id
LEFT JOIN profissionais p ON p.id = ep.profissional_id
WHERE e.id = '00000000-0000-0000-0000-000000000001'
GROUP BY e.id, e.nome, e.status_conta;

-- PASSO 5: Testar RPC
-- ====================
SELECT * FROM get_companies_stats();
