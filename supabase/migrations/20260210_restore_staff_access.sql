-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- MIGRATION: RESTORE STAFF ACCESS (RECOVERY)
-- DATE: 2026-02-10
-- DESCRIPTION:
-- Rolling back the "Collaboration" feature (viewing sibling tasks) because
-- it caused recursion/performance issues leading to empty task lists.
-- Restoring simple access: Own Tasks + Created OS Tasks.
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

BEGIN;

-- 1. Drop the problematic policy
DROP POLICY IF EXISTS "Professionals view team micro tasks" ON tarefas_micro;

-- 2. Re-create SAFE policy (No recursion risk)
CREATE POLICY "Professionals view team micro tasks"
ON tarefas_micro
FOR SELECT
TO authenticated
USING (
    -- 1. My own tasks (Priority)
    profissional_id = auth.uid()
    
    OR
    
    -- 2. I am the Creator of the Macro Task
    -- Using the SECURITY DEFINER function from previous hotfix
    -- If function doesn't exist, this will fail, so we recreate it to be safe
    (
        SELECT EXISTS (
            SELECT 1 
            FROM tarefas 
            WHERE id = tarefas_micro.tarefa_id 
            AND created_by = auth.uid()
        )
    )
);

-- Note: We use direct subquery for #2 because if 'tarefas' has RLS that checks 'tarefas_micro',
-- ANY check on 'tarefas' is risky.
-- Ideally we use the SECURITY DEFINER function 'fn_check_is_os_creator'.
-- Let's rely on that function existing (from 20260210_hotfix_recursion.sql).
-- If we are unsure, we should redefine it here.

CREATE OR REPLACE FUNCTION public.fn_check_is_os_creator_safe(target_os_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 
        FROM tarefas 
        WHERE id = target_os_id 
        AND created_by = auth.uid()
    );
END;
$$;

-- Simplify Policy to use the safe function
DROP POLICY IF EXISTS "Professionals view team micro tasks" ON tarefas_micro;

CREATE POLICY "Professionals view team micro tasks"
ON tarefas_micro
FOR SELECT
TO authenticated
USING (
    -- 1. My own tasks
    profissional_id = auth.uid()
    
    OR
    
    -- 2. Creator (Safe Wrapper)
    fn_check_is_os_creator_safe(tarefa_id)
);

COMMENT ON POLICY "Professionals view team micro tasks" ON tarefas_micro IS 
'RECOVERY: Collaboration disabled. Only assignee and creator can view.';

COMMIT;
