-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- HOTFIX: RLS RECURSION BREAKER (V3 - ROBUST)
-- DESCRIPTION: Breaks infinite loop in 'tarefas_micro'.
-- CHANGE: Inlines 'is_admin' check to avoid 'function does not exist' errors.
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
    -- This query runs with elevated privileges, ignoring RLS policies
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
DROP POLICY IF EXISTS "Global Constraint: Tenant Isolation for Admins" ON tarefas_micro;

CREATE POLICY "Global Constraint: Tenant Isolation for Admins"
ON tarefas_micro
AS RESTRICTIVE
FOR ALL
TO authenticated
USING (
    -- Logic:
    -- IF User is Admin -> Check Link via Safe Function
    -- ELSE -> Pass through (allow permissive policies to decide)
    
    CASE 
        -- INLINED CHECK: Verify if user is admin directly against table
        -- This avoids "function is_admin() does not exist" errors
        WHEN EXISTS (
            SELECT 1 FROM profissionais 
            WHERE id = auth.uid() 
            AND role = 'admin'
        ) THEN 
            check_admin_micro_task_access(id)
        ELSE 
            -- Non-admins (Staff/SuperAdmin handled inside function or permissive policies)
            TRUE
    END
);
