-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- Migration 1018: Ajustar schema para ETAPA 4
-- Data: 2026-01-07
-- Descrição: Adicionar has_micro_tasks e deleted_at ao schema
--            Preparar schema para governança
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

BEGIN;

-- 1. Adicionar campo has_micro_tasks (se não existir)
ALTER TABLE tarefas
ADD COLUMN IF NOT EXISTS has_micro_tasks BOOLEAN DEFAULT false;

-- 2. Atualizar valores existentes baseado na existência de micro-tasks
UPDATE tarefas t
SET has_micro_tasks = EXISTS (
    SELECT 1 FROM tarefas_micro tm
    WHERE tm.tarefa_id = t.id
);

-- 3. Definir NOT NULL para has_micro_tasks
ALTER TABLE tarefas
ALTER COLUMN has_micro_tasks SET NOT NULL;

-- 4. Adicionar campo deleted_at para soft delete
ALTER TABLE tarefas
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- 5. Índice para performance em queries de OSs não excluídas
CREATE INDEX IF NOT EXISTS idx_tarefas_deleted_at 
ON tarefas(deleted_at) 
WHERE deleted_at IS NOT NULL;

-- 6. Índice para filtrar OSs ativas (não excluídas)
CREATE INDEX IF NOT EXISTS idx_tarefas_ativas 
ON tarefas(empresa_id, status) 
WHERE deleted_at IS NULL;

-- 7. Índice para OSs complexas
CREATE INDEX IF NOT EXISTS idx_tarefas_has_micro 
ON tarefas(has_micro_tasks) 
WHERE has_micro_tasks = true;

-- Comentários
COMMENT ON COLUMN tarefas.has_micro_tasks IS 'ETAPA 4: Flag auxiliar. TRUE = OS complexa (workflow). Fonte da verdade: existência de registros em tarefas_micro. Calculado automaticamente na conversão';
COMMENT ON COLUMN tarefas.deleted_at IS 'ETAPA 4: Soft delete. NULL = ativa, NOT NULL = excluída. Evento os_excluida registra a exclusão';

-- Log
DO $$
BEGIN
    RAISE NOTICE '✅ Migration 1018: Schema ajustado para ETAPA 4 (has_micro_tasks, deleted_at)';
END $$;

COMMIT;
