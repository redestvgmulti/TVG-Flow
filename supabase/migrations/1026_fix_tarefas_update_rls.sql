-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- Migration 1026: Fix Tarefas Update RLS for Admins
-- Date: 2026-01-12
-- Description: Explicitly grants Admins permission to UPDATE any task.
--              Solves issue where Admins cannot complete tasks created by others.
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

BEGIN;

-- 1. Create Policy: Admins can update all tasks
-- Using is_admin_safe() to prevent recursion
CREATE POLICY "Admins can update all tasks"
ON tarefas FOR UPDATE
TO authenticated
USING (
    is_admin_safe()
)
WITH CHECK (
    is_admin_safe()
);

-- 2. Log
DO $$
BEGIN
    RAISE NOTICE '✅ Migration 1026: Admin UPDATE policy created for tarefas.';
END $$;

COMMIT;
