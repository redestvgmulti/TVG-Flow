-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- Migration 1028: Fix Global Task Completion RLS
-- Date: 2026-01-12
-- Description: Fixes the 'tarefas' UPDATE policy which was too restrictive.
--              1. Adds check for 'tarefas_micro' (fixes 029 mismatch).
--              2. Restores access for 'assigned_to' (legacy/simple tasks).
--              3. Restores access for 'created_by'.
--              NOTE: Removed check for 'tarefas_itens' as table may not exist/be active.
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

BEGIN;

-- Drop the restrictive/broken policy from Migration 029
DROP POLICY IF EXISTS "Professionals update only assigned tasks" ON tarefas;
DROP POLICY IF EXISTS "Professionals can update accessible tasks" ON tarefas; -- Clean up if partially created

-- Create the robust, correct policy
CREATE POLICY "Professionals can update accessible tasks"
ON tarefas FOR UPDATE
TO authenticated
USING (
    -- 1. Admin (Safe Check)
    is_admin_safe()
    OR
    -- 2. Direct Assignment (Legacy/Simple Tasks)
    assigned_to = auth.uid()
    OR
    -- 3. Creator (Can usually edit their own requests)
    created_by = auth.uid()
    OR
    -- 4. Micro-Task Assignment (Complex Tasks) - CORRECT TABLE 'tarefas_micro'
    EXISTS (
        SELECT 1 FROM tarefas_micro tm
        WHERE tm.tarefa_id = tarefas.id
        AND tm.profissional_id = auth.uid()
    )
)
WITH CHECK (
    -- Symmetric Check
    is_admin_safe()
    OR
    assigned_to = auth.uid()
    OR
    created_by = auth.uid()
    OR
    EXISTS (
        SELECT 1 FROM tarefas_micro tm
        WHERE tm.tarefa_id = tarefas.id
        AND tm.profissional_id = auth.uid()
    )
);

-- Log success
DO $$
BEGIN
    RAISE NOTICE '✅ Migration 1028: Fixed tarefas UPDATE RLS (Added tarefas_micro + Legacy roles)';
END $$;

COMMIT;
