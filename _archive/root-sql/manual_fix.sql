-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- MANUAL FIX FOR FLOWOS PERFORMANCE (FASE 4)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- INSTRUCTIONS:
-- 1. Copy this entire script.
-- 2. Go to Supabase Dashboard > SQL Editor.
-- 3. Paste and Run.
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

BEGIN;

-- 1. Ensure 'deadline_at' column exists on 'tarefas'
-- (Found missing during analysis)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'tarefas' AND column_name = 'deadline_at'
    ) THEN
        ALTER TABLE tarefas ADD COLUMN deadline_at TIMESTAMP WITH TIME ZONE;
        RAISE NOTICE 'Added deadline_at column to tarefas';
    END IF;
END $$;

-- 2. TASKS DASHBOARD INDEXES
CREATE INDEX IF NOT EXISTS idx_tarefas_empresa_status_deadline
ON tarefas (empresa_id, status, deadline_at ASC);

CREATE INDEX IF NOT EXISTS idx_tarefas_empresa_status_created
ON tarefas (empresa_id, status, created_at DESC);

-- 3. PROFESSIONAL DASHBOARD INDEXES
CREATE INDEX IF NOT EXISTS idx_tarefas_micro_prof_status_deadline
ON tarefas_micro (profissional_id, status, deadline_at ASC);

-- 4. NOTIFICATIONS INDEX
CREATE INDEX IF NOT EXISTS idx_notificacoes_prof_unread_created
ON notificacoes (profissional_id, created_at DESC)
WHERE lida = false;

COMMIT;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- VERIFICATION ONLY (Run separately if needed)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- SELECT indexname FROM pg_indexes WHERE tablename IN ('tarefas', 'tarefas_micro', 'notificacoes');
