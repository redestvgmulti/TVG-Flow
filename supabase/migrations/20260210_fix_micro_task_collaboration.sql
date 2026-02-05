-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- MIGRATION: FIX MICRO TASK COLLABORATION VISIBILITY
-- DATE: 2026-02-03
-- DESCRIPTION:
-- Allow Staff users to view "sibling" micro-tasks (tasks assigned to others
-- within the same SERVICE ORDER). This is required for the "Return" feature
-- (loadWorkflowProfessionals) to list other participants.
--
-- Logic:
-- 1. Can see if assigned to me (Standard)
-- 2. Can see if I am the Creator of the Macro Task (Owner)
-- 3. Can see if I have ANY task in this same Macro Task (Collaboration)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

BEGIN;

-- 1. Drop the old restrictive "View Own" policy
DROP POLICY IF EXISTS "Professionals view own micro tasks" ON tarefas_micro;

-- 2. Create the new Collaborative Policy
CREATE POLICY "Professionals view team micro tasks"
ON tarefas_micro
FOR SELECT
TO authenticated
USING (
    -- 1. My own tasks
    profissional_id = auth.uid()
    
    OR
    
    -- 2. I am the Creator of the Macro Task
    EXISTS (
        SELECT 1 
        FROM tarefas t 
        WHERE t.id = tarefas_micro.tarefa_id 
        AND t.created_by = auth.uid()
    )

    OR

    -- 3. Collaboration: I have a task (sibling) in this same OS
    EXISTS (
        SELECT 1 
        FROM tarefas_micro tm_sibling
        WHERE tm_sibling.tarefa_id = tarefas_micro.tarefa_id
        AND tm_sibling.profissional_id = auth.uid()
    )
);

-- Note: Admin/SuperAdmin access is strictly enforced by "Global Constraint" policies 
-- or by separate Admin policies if they exist. This policy applies to the base 
-- "Authenticated" role (Staff).

COMMENT ON POLICY "Professionals view team micro tasks" ON tarefas_micro IS 
'Permits users to see all micro-tasks in an OS if they are the Creator OR if they are a participant (have at least one task in it). Essential for return/handover flows.';

COMMIT;
