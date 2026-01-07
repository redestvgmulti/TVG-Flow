-- Migration: Executive Dashboard Support
-- Created: 2026-01-07 14:15:00
-- Description: Adds view and RPC for efficient, secure dashboard data fetching.

-- 1. View for Operational Summary (Optional helper, but good for debugging)
CREATE OR REPLACE VIEW os_dashboard_summary AS
SELECT
    t.id,
    t.empresa_id,
    t.titulo,
    t.status,
    t.priority,
    t.deadline,
    t.assigned_to,
    t.created_at,
    CASE 
        WHEN t.deadline < NOW() AND t.status NOT IN ('completed', 'concluida', 'concluído', 'done') THEN true 
        ELSE false 
    END as is_overdue
FROM
    tarefas t;

-- 2. RPC for Consolidated Dashboard Data
-- Returns a single JSON object with all necessary metrics, lists, and charts data.
CREATE OR REPLACE FUNCTION get_dashboard_data(p_empresa_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_result JSONB;
BEGIN
    -- 1. Security Check: Validate User-Company Link
    IF NOT EXISTS (
        SELECT 1 FROM empresa_profissionais
        WHERE profissional_id = v_user_id AND empresa_id = p_empresa_id
    ) THEN
        RAISE EXCEPTION 'Acesso negado: Usuário não vinculado a esta empresa.';
    END IF;

    -- 2. Build Response
    SELECT jsonb_build_object(
        'summary', (
            SELECT jsonb_build_object(
                'total', COUNT(*),
                'active', COUNT(*) FILTER (WHERE status IN ('pending', 'in_progress', 'pendente', 'em_andamento', 'todo', 'doing')),
                'completed', COUNT(*) FILTER (WHERE status IN ('completed', 'concluida', 'concluído', 'done')),
                'overdue', COUNT(*) FILTER (WHERE deadline < NOW() AND status NOT IN ('completed', 'concluida', 'concluído', 'done'))
            )
            FROM tarefas t
            WHERE t.empresa_id = p_empresa_id
        ),
        'recent_tasks', COALESCE((
            SELECT jsonb_agg(sub)
            FROM (
                SELECT id, titulo, status, priority, deadline, assigned_to, created_at
                FROM tarefas
                WHERE empresa_id = p_empresa_id
                ORDER BY created_at DESC
                LIMIT 5
            ) sub
        ), '[]'::jsonb),
        'tasks_by_status', (
             SELECT jsonb_agg(stats)
             FROM (
                SELECT status, COUNT(*) as count
                FROM tarefas
                WHERE empresa_id = p_empresa_id
                GROUP BY status
             ) stats
        ),
        'productivity', COALESCE((
            SELECT jsonb_agg(prod)
             FROM (
                SELECT 
                    p.id,
                    p.nome,
                    COUNT(t.id) FILTER (WHERE t.status IN ('in_progress', 'em_andamento', 'doing')) as active_count,
                    COUNT(t.id) FILTER (WHERE t.status IN ('completed', 'concluida', 'done')) as completed_count
                FROM profissionais p
                JOIN empresa_profissionais ep ON ep.profissional_id = p.id
                LEFT JOIN tarefas t ON t.assigned_to = p.id AND t.empresa_id = p_empresa_id
                WHERE ep.empresa_id = p_empresa_id
                GROUP BY p.id, p.nome
                ORDER BY p.nome ASC
             ) prod
        ), '[]'::jsonb)
    ) INTO v_result;

    RETURN v_result;
END;
$$;
