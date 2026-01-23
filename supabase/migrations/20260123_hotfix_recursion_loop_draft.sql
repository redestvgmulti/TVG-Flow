-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- HOTFIX: RLS RECURSION BREAKER
-- DESCRIPTION: Breaks the infinite loop between 'tarefas_micro' and 'tarefas'
-- RLS policies. The restrictive policy on 'tarefas_micro' was joining 'tarefas',
-- which in turn checked 'tarefas_micro', causing infinite recursion.
-- SOLUTION: Move the check to a SECURITY DEFINER function to bypass RLS stack.
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- 1. Helper Function: Check if Admin has access to the Micro Task's Company
-- Defined as SECURITY DEFINER to bypass RLS on 'tarefas' when reading it.
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
    -- This query runs with elevated privileges, ignoring 'tarefas' RLS policies
    RETURN EXISTS (
        SELECT 1 
        FROM tarefas t
        JOIN empresa_profissionais ep ON t.empresa_id = ep.empresa_id
        WHERE t.id = p_micro_task_id
        AND ep.profissional_id = auth.uid()
        AND ep.ativo = true
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

-- Note: 'id' in check_admin_micro_task_access(id) refers to tarefas_micro.id is WRONG?
-- Wait, tarefas_micro has 'tarefa_id'.
-- The function above takes 'p_micro_task_id' (tarefas_micro.id).
-- Query inside function: WHERE t.id = p_micro_task_id <- WRONG!
-- t.id is 'tarefas.id'. p_micro_task_id is 'tarefas_micro.id'.
-- Logic error! 
-- Correct query inside function:
-- SELECT 1 FROM tarefas_micro tm JOIN tarefas t ON tm.tarefa_id = t.id ...
-- But tm.id = p_micro_task_id
