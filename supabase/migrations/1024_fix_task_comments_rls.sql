-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- Migration 1024: Fix Task Comments RLS (Permissive Insert)
-- Date: 2026-01-12
-- Description: Allows any authenticated staff member to insert comments.
--              Replaces restrictiver policies for INSERT action.
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

BEGIN;

-- 1. Enable RLS (Ensure it's on)
ALTER TABLE task_comments ENABLE ROW LEVEL SECURITY;

-- 2. Drop potential conflicting or restrictive old policies if intended to be replaced
-- (Dropping "Criar comentário na OS" from 1010 to avoid confusion, though PostgreSQL policies are OR'ed)
DROP POLICY IF EXISTS "Criar comentário na OS" ON task_comments;
DROP POLICY IF EXISTS "Admin can insert comments" ON task_comments;
DROP POLICY IF EXISTS "Professionals insert comments on accessible tasks" ON task_comments;

-- 3. Create Permissive Policy
CREATE POLICY "Staff can insert comments"
ON task_comments
FOR INSERT
TO authenticated
WITH CHECK (
    -- Any authenticated user can comment
    auth.uid() IS NOT NULL
);

-- 4. Log
DO $$
BEGIN
    RAISE NOTICE '✅ Migration 1024: Policy "Staff can insert comments" created. All auth users can now comment.';
END $$;

COMMIT;
