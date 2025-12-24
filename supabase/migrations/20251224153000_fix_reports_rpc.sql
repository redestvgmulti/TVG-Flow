-- FIX: Re-create Report RPCs (Fix for PGRST202 error & Missing Table & Missing Column)
-- Description: 
-- 1. Updates get_client_stats to query 'clientes' table.
-- 2. Updates get_role_stats to use 'departamentos.nome' (Department) as the "Role" proxy.

-- 1. Get Client/Company Stats
CREATE OR REPLACE FUNCTION get_client_stats(
    start_date TIMESTAMP WITH TIME ZONE DEFAULT NULL,
    end_date TIMESTAMP WITH TIME ZONE DEFAULT NULL
)
RETURNS TABLE (
    client_id UUID,
    client_name TEXT,
    total_tasks BIGINT,
    completed_tasks BIGINT,
    overdue_tasks BIGINT,
    avg_resolution_time_hours NUMERIC
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        c.id as client_id,
        c.nome as client_name,
        COUNT(t.id) as total_tasks,
        COUNT(t.id) FILTER (WHERE t.status IN ('completed', 'concluida')) as completed_tasks,
        COUNT(t.id) FILTER (
            WHERE t.status NOT IN ('completed', 'concluida') 
            AND t.deadline < now()
        ) as overdue_tasks,
        COALESCE(
            AVG(
                EXTRACT(EPOCH FROM (COALESCE(t.completed_at, now()) - t.created_at))/3600
            ) FILTER (WHERE t.status IN ('completed', 'concluida')), 
            0
        )::NUMERIC(10,2) as avg_resolution_time_hours
    FROM clientes c
    LEFT JOIN tarefas t ON t.cliente_id = c.id
    WHERE (start_date IS NULL OR t.created_at >= start_date)
      AND (end_date IS NULL OR t.created_at <= end_date)
    GROUP BY c.id, c.nome
    ORDER BY total_tasks DESC;
END;
$$ LANGUAGE plpgsql;

-- 2. Get Role/Department Stats (Replacing missing funcao_snapshot)
-- We use Department Name as the grouping key.
CREATE OR REPLACE FUNCTION get_role_stats(
    start_date TIMESTAMP WITH TIME ZONE DEFAULT NULL,
    end_date TIMESTAMP WITH TIME ZONE DEFAULT NULL
)
RETURNS TABLE (
    role_name TEXT,
    total_items BIGINT,
    completed_items BIGINT,
    avg_completion_hours NUMERIC
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COALESCE(d.nome, 'Sem Departamento') as role_name,
        COUNT(ti.id) as total_items,
        COUNT(ti.id) FILTER (WHERE ti.status IN ('completed', 'concluida')) as completed_items,
        COALESCE(
            AVG(
                EXTRACT(EPOCH FROM (COALESCE(ti.concluida_at, now()) - ti.created_at))/3600
            ) FILTER (WHERE ti.status IN ('completed', 'concluida')), 
            0
        )::NUMERIC(10,2) as avg_completion_hours
    FROM tarefas_itens ti
    JOIN profissionais p ON p.id = ti.profissional_id
    LEFT JOIN departamentos d ON d.id = p.departamento_id
    WHERE (start_date IS NULL OR ti.created_at >= start_date)
      AND (end_date IS NULL OR ti.created_at <= end_date)
    GROUP BY d.nome
    ORDER BY total_items DESC;
END;
$$ LANGUAGE plpgsql;

-- 3. Get Staff Stats (Colaborador)
CREATE OR REPLACE FUNCTION get_staff_stats(
    start_date TIMESTAMP WITH TIME ZONE DEFAULT NULL,
    end_date TIMESTAMP WITH TIME ZONE DEFAULT NULL
)
RETURNS TABLE (
    staff_id UUID,
    staff_name TEXT,
    total_assigned BIGINT,
    completed_count BIGINT,
    overdue_count BIGINT,
    efficiency_score NUMERIC
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        p.id,
        p.nome,
        COUNT(ti.id) as total_assigned,
        COUNT(ti.id) FILTER (WHERE ti.status IN ('completed', 'concluida')) as completed_count,
        -- Overdue micro-tasks (if parent task is overdue and micro-task is not done)
        COUNT(ti.id) FILTER (
            WHERE ti.status NOT IN ('completed', 'concluida')
            AND EXISTS (
                SELECT 1 FROM tarefas t 
                WHERE t.id = ti.tarefa_id 
                AND t.deadline < now()
            )
        ) as overdue_count,
        -- Simple efficiency score: (Completed / Total) * 100
        CASE 
            WHEN COUNT(ti.id) > 0 THEN 
                (COUNT(ti.id) FILTER (WHERE ti.status IN ('completed', 'concluida'))::NUMERIC / COUNT(ti.id)::NUMERIC) * 100
            ELSE 0 
        END::NUMERIC(5,2) as efficiency_score
    FROM profissionais p
    JOIN tarefas_itens ti ON ti.profissional_id = p.id
    WHERE (start_date IS NULL OR ti.created_at >= start_date)
      AND (end_date IS NULL OR ti.created_at <= end_date)
    GROUP BY p.id, p.nome
    ORDER BY completed_count DESC;
END;
$$ LANGUAGE plpgsql;

-- Grant permissions again just in case
GRANT EXECUTE ON FUNCTION get_client_stats(TIMESTAMP WITH TIME ZONE, TIMESTAMP WITH TIME ZONE) TO authenticated;
GRANT EXECUTE ON FUNCTION get_role_stats(TIMESTAMP WITH TIME ZONE, TIMESTAMP WITH TIME ZONE) TO authenticated;
GRANT EXECUTE ON FUNCTION get_staff_stats(TIMESTAMP WITH TIME ZONE, TIMESTAMP WITH TIME ZONE) TO authenticated;
