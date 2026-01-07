-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- Migration: Normalizar status para português
-- Data: 2026-01-07
-- Descrição: Padronizar valores de status de inglês para português
-- Etapa: 1 - Correção da Base
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

BEGIN;

-- Passo 1: Atualizar valores existentes
UPDATE tarefas 
SET status = CASE 
    WHEN status = 'pending' THEN 'pendente'
    WHEN status = 'in_progress' THEN 'em_execucao'
    WHEN status = 'completed' THEN 'concluida'
    WHEN status = 'overdue' THEN 'atrasada'
    ELSE status  -- Mantém valores já em português ou desconhecidos
END
WHERE status IN ('pending', 'in_progress', 'completed', 'overdue');

-- Passo 1.1: Limpeza de segurança (Fallback)
-- Garante que qualquer status desconhecido/lixo seja movido para 'pendente'
-- Isso evita erro de constraint violation se houverem status antigos esquecidos
UPDATE tarefas
SET status = 'pendente'
WHERE status NOT IN ('pendente', 'em_execucao', 'concluida', 'atrasada');

-- Passo 2: Atualizar constraint
ALTER TABLE tarefas DROP CONSTRAINT IF EXISTS tarefas_status_check;

ALTER TABLE tarefas ADD CONSTRAINT tarefas_status_check
    CHECK (status IN ('pendente', 'em_execucao', 'concluida', 'atrasada'));

-- Passo 3: Atualizar default
ALTER TABLE tarefas ALTER COLUMN status SET DEFAULT 'pendente';

-- Log de execução
DO $$
DECLARE
    updated_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO updated_count FROM tarefas WHERE status IN ('pendente', 'em_execucao', 'concluida', 'atrasada');
    RAISE NOTICE 'Migration completed. Total tarefas with normalized status: %', updated_count;
END $$;

COMMIT;
