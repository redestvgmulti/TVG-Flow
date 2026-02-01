-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- Fix Micro Task Status Constraint
-- Migration 029: Ensure 'devolvida' is in the allowed status list
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

DO $$
BEGIN
    -- Drop the constraint if it exists
    IF EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'tarefas_micro_status_check'
    ) THEN
        ALTER TABLE tarefas_micro DROP CONSTRAINT tarefas_micro_status_check;
    END IF;

    -- Add the correct constraint
    ALTER TABLE tarefas_micro
    ADD CONSTRAINT tarefas_micro_status_check 
    CHECK (status IN ('pendente', 'bloqueada', 'em_execucao', 'concluida', 'devolvida'));

END $$;
