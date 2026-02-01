-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- HOTFIX: RLS RECURSION BREAKER (CORRECTED)
-- DESCRIPTION: Breaks the infinite loop between 'tarefas_micro' and 'tarefas'
-- RLS policies. The restrictive policy on 'tarefas_micro' was joining 'tarefas',
-- which in turn checked 'tarefas_micro', causing infinite recursion.
-- SOLUTION: Move the check to a SECURITY DEFINER function to bypass RLS stack.
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- 1. Update the Restrictive Policy on 'tarefas_micro'
-- Drop the recursive version FIRST to release dependency on the function
DROP POLICY IF EXISTS "Global Constraint: Tenant Isolation for Admins" ON tarefas_micro;

-- 2. Helper Function: Check if Admin has access to the Micro Task's Company
-- Defined as SECURITY DEFINER to bypass RLS on 'tarefas' when reading it.
-- Add explicit drop to avoid return type conflict
DROP FUNCTION IF EXISTS check_admin_micro_task_access(UUID);
CREATE OR REPLACE FUNCTION check_admin_micro_task_access(p_micro_task_id UUID)
RETURNS BOOLEAN
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- If user is Super Admin, allow immediately
    IF EXISTS (SELECT 1 FROM profissionais WHERE id = auth.uid() AND role = 'super_admin') THEN
        RETURN TRUE;
    END IF;

    -- If user is Admin, check tenant link
    -- This query runs with elevated privileges (Creator/Superuser), 
    -- ignoring RLS policies on 'tarefas' and 'tarefas_micro'.
    RETURN EXISTS (
        SELECT 1 
        FROM tarefas_micro tm
        JOIN tarefas t ON tm.tarefa_id = t.id
        JOIN empresa_profissionais ep ON t.empresa_id = ep.empresa_id
        WHERE tm.id = p_micro_task_id
        AND ep.profissional_id = auth.uid()
AND EXISTS (SELECT 1 FROM profissionais WHERE id = auth.uid() AND role = 'admin')
    );
END;
$$ LANGUAGE plpgsql;

-- 2. Update the Restrictive Policy on 'tarefas_micro'
-- Drop the recursive version
DROP POLICY IF EXISTS "Global Constraint: Tenant Isolation for Admins" ON tarefas_micro;

-- Create the new safe version using the function
CREATE POLICY "Global Constraint: Tenant Isolation for Admins"
ON tarefas_micro
AS RESTRICTIVE
FOR ALL
TO authenticated
USING (
    -- If Super Admin or Admin linked to the task -> TRUE via helper
    -- If Staff -> TRUE (pass through to permissive policies)
    CASE 
        WHEN public.is_admin() THEN 
            check_admin_micro_task_access(id) -- Uses the safe helper
        ELSE 
            TRUE
    END
);

-- Note: 'id' in the USING clause refers to the row being accessed in 'tarefas_micro'.
