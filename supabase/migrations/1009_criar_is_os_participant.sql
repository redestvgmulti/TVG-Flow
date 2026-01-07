-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- Migration 1009: Criar função is_os_participant()
-- Data: 2026-01-07
-- Descrição: Função helper SECURITY DEFINER para verificar se usuário
--            é participante de uma OS. Centraliza lógica de RLS.
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

BEGIN;

-- Criar função helper para verificar participação em OS
CREATE OR REPLACE FUNCTION is_os_participant(p_os_id UUID)
RETURNS BOOLEAN
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM tarefas t
        WHERE t.id = p_os_id
        AND (
            -- Admin vê tudo (usando função safe)
            is_admin_safe()
            OR
            -- Criador da OS
            t.created_by = auth.uid()
            OR
            -- Atribuído direto (OS simples)
            t.assigned_to = auth.uid()
            OR
            -- Atribuído via micro-task (OS complexa)
            EXISTS (
                SELECT 1 FROM tarefas_micro tm
                WHERE tm.tarefa_id = t.id
                AND tm.profissional_id = auth.uid()
            )
        )
    );
END;
$$ LANGUAGE plpgsql;

-- Comentários
COMMENT ON FUNCTION is_os_participant IS 'ETAPA 3: Verifica se usuário autenticado é participante da OS (criador, atribuído direto, ou micro-task). Usa SECURITY DEFINER para evitar recursão RLS.';

-- Log
DO $$
BEGIN
    RAISE NOTICE '✅ Migration 1009: Função is_os_participant() criada (SECURITY DEFINER)';
END $$;

COMMIT;
