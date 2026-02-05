-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- HOTFIX: BREAK RLS RECURSION
-- DATE: 2026-02-04
-- DESCRIPTION:
-- The previous collaboration fix introduced a cycle:
-- tarefas -> (RLS) -> tarefas_micro -> (RLS) -> tarefas
--
-- Solution:
-- Use SECURITY DEFINER functions to query the 'other' table without 
-- triggering its RLS policies.
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

BEGIN;

-- 1. Helper Function: Check if user is creator of OS (Bypass tarefas RLS)
CREATE OR REPLACE FUNCTION public.fn_check_is_os_creator(target_os_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER -- Runs as Owner (Superuser), bypassing RLS
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

-- 2. Helper Function: Check if user is participant in OS (Bypass tarefas_micro RLS)
-- Used for the "Sibling" check efficiently
CREATE OR REPLACE FUNCTION public.fn_check_is_os_participant(target_os_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 
        FROM tarefas_micro 
        WHERE tarefa_id = target_os_id
        AND profissional_id = auth.uid()
    );
END;
$$;

-- 3. Update the Policy to Use Safe Functions
DROP POLICY IF EXISTS "Professionals view team micro tasks" ON tarefas_micro;

CREATE POLICY "Professionals view team micro tasks"
ON tarefas_micro
FOR SELECT
TO authenticated
USING (
    -- 1. My own tasks (Fastest)
    profissional_id = auth.uid()
    
    OR
    
    -- 2. I am the Creator of the Macro Task (Safe Wrapper)
    fn_check_is_os_creator(tarefa_id)

    OR

    -- 3. Collaboration: I am a participant in this OS (Safe Wrapper)
    -- If I have *any* task in this OS, I can see all other tasks in it.
    fn_check_is_os_participant(tarefa_id)
);

COMMENT ON POLICY "Professionals view team micro tasks" ON tarefas_micro IS 
'Fixed: Recursion-safe policy using SECURITY DEFINER functions to check parent/sibling status.';

COMMIT;
