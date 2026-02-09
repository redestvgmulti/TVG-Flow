-- Migration: Backfill ordem column for existing micro tasks
-- Created: 2026-02-09
-- Purpose: Populate ordem for legacy tasks created before workflow system

-- This migration assigns ordem values to existing tarefas_micro records
-- based on their creation timestamp (created_at)
--
-- Logic:
-- - Group tasks by tarefa_id (OS)
-- - Order by created_at ASC within each group
-- - Assign ordem = 1, 2, 3, ... based on creation order
-- - Oldest task in each OS gets ordem = 1

DO $$
DECLARE
    updated_count INTEGER;
BEGIN
    -- Update tarefas_micro with calculated ordem based on created_at
    WITH ranked_tasks AS (
        SELECT 
            id,
            ROW_NUMBER() OVER (
                PARTITION BY tarefa_id 
                ORDER BY created_at ASC, id ASC
            ) AS calculated_ordem
        FROM tarefas_micro
        WHERE ordem IS NULL  -- Only update tasks without ordem
    )
    UPDATE tarefas_micro t
    SET ordem = r.calculated_ordem
    FROM ranked_tasks r
    WHERE t.id = r.id;

    -- Get count of updated rows
    GET DIAGNOSTICS updated_count = ROW_COUNT;
    
    -- Log the result
    RAISE NOTICE 'Backfill completed: % tasks updated with ordem', updated_count;
END $$;

-- Verify the backfill
-- This query groups tasks by OS and shows their ordem distribution
DO $$
DECLARE
    os_count INTEGER;
    task_count INTEGER;
BEGIN
    SELECT COUNT(DISTINCT tarefa_id), COUNT(*)
    INTO os_count, task_count
    FROM tarefas_micro
    WHERE ordem IS NOT NULL;
    
    RAISE NOTICE 'Verification: % OSs with % ordered tasks', os_count, task_count;
END $$;

-- Create a diagnostic view to inspect ordem distribution per OS
-- (Optional - comment out if not needed)
CREATE OR REPLACE VIEW vw_ordem_diagnostics AS
SELECT 
    tm.tarefa_id,
    t.titulo AS os_titulo,
    COUNT(*) AS total_etapas,
    MIN(tm.ordem) AS menor_ordem,
    MAX(tm.ordem) AS maior_ordem,
    ARRAY_AGG(
        ROW(tm.ordem, p.nome, tm.funcao, tm.status)::TEXT 
        ORDER BY tm.ordem
    ) AS etapas_detalhes
FROM tarefas_micro tm
JOIN tarefas t ON t.id = tm.tarefa_id
JOIN profissionais p ON p.id = tm.profissional_id
WHERE tm.ordem IS NOT NULL
GROUP BY tm.tarefa_id, t.titulo
ORDER BY tm.tarefa_id;

COMMENT ON VIEW vw_ordem_diagnostics IS 'View para diagnosticar distribuição de ordem nas OSs. Use: SELECT * FROM vw_ordem_diagnostics LIMIT 10;';

-- NOTES:
-- 1. This migration is IDEMPOTENT - can be run multiple times safely (WHERE ordem IS NULL)
-- 2. ordem is assigned based on created_at timestamp (oldest = 1)
-- 3. For tasks created at exactly the same time, id (UUID) is used as tiebreaker
-- 4. This represents the ORIGINAL workflow order as tasks were created
-- 5. To inspect results: SELECT * FROM vw_ordem_diagnostics WHERE os_titulo LIKE '%CERIMÔNIA%';
