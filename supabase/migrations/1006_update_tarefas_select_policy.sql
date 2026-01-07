-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- Migration: Update tarefas SELECT Policy (Etapa 2)
-- Data: 2026-01-07
-- Descrição: Unificação de Solicitação e OS - Atualizar policy para:
--   1. Usar is_admin_safe() ao invés de subquery direta
--   2. Incluir created_by (staff vê OS que criou)
--   3. Incluir assigned_to (OS simples visíveis ao atribuído)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

BEGIN;

-- Drop policy antiga (migration 029)
DROP POLICY IF EXISTS "Professionals see only assigned tasks via micro-tasks" ON tarefas;

-- Criar policy unificada para Etapa 2
CREATE POLICY "Ver OS atribuídas ou criadas"
ON tarefas FOR SELECT
TO authenticated
USING (
    -- Admin vê todas (usando função safe - evita recursão)
    is_admin_safe()
    OR
    -- Criador vê suas OS (incluído na Etapa 1, agora na policy)
    created_by = auth.uid()
    OR
    -- Atribuído direto vê (OS simples)
    assigned_to = auth.uid()
    OR
    -- Atribuído via micro-task vê a macro-task (OS complexa)
    EXISTS (
        SELECT 1
        FROM tarefas_micro tm
        WHERE tm.tarefa_id = tarefas.id
        AND tm.profissional_id = auth.uid()
    )
);

-- Comentário
COMMENT ON POLICY "Ver OS atribuídas ou criadas" ON tarefas IS 
'ETAPA 2: Unificação de OS. Policy consolida visibilidade para OS simples (created_by, assigned_to) e complexa (micro-tasks). Usa is_admin_safe() para evitar recursão.';

-- Log
DO $$
BEGIN
    RAISE NOTICE '✅ Migration 1006: Policy SELECT de tarefas atualizada para Etapa 2 - Unificação de OS';
END $$;

COMMIT;
