-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- RPC: count_unassigned_tasks
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 
-- Conta tarefas que NÃO possuem nenhuma micro-task com profissional atribuído
-- 
-- REGRAS:
-- - Exclui tarefas concluídas e canceladas
-- - Uma tarefa é "sem responsável" se NENHUMA de suas micro-tasks tem profissional_id
-- - Performance: O(1) - query agregada única
-- 
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Add explicit drop to avoid return type conflict
DROP FUNCTION IF EXISTS count_unassigned_tasks(UUID);
CREATE OR REPLACE FUNCTION count_unassigned_tasks()
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT COUNT(*)::INTEGER
  FROM tarefas t
  WHERE t.status NOT IN ('concluida', 'cancelada')
  AND NOT EXISTS (
    SELECT 1
    FROM tarefas_micro tm
    WHERE tm.tarefa_id = t.id
    AND tm.profissional_id IS NOT NULL
  );
$$;

-- Comentário descritivo
COMMENT ON FUNCTION count_unassigned_tasks IS 
  'Conta tarefas ativas/pendentes que não possuem nenhuma micro-task atribuída a um profissional. Usado para métrica "Sem Responsável" do Dashboard.';

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION count_unassigned_tasks TO authenticated;
