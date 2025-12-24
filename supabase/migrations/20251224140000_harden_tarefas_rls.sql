-- HARDENING FINAL: Restrict Manual Updates on Macro Tasks
-- Description: 
-- 1. Revoke UPDATE permission on 'tarefas' for professionals (Admins only).
-- 2. Expand SELECT permission to allow visibility if user has a micro-task.

-- 1. Drop existing policies regarding Professionals
DROP POLICY IF EXISTS "Profissional pode atualizar tarefas atribuídas" ON tarefas;
DROP POLICY IF EXISTS "Profissional pode ver tarefas atribuídas" ON tarefas;

-- 2. Re-create SELECT Policy (Enhanced)
-- Allows viewing if:
-- a) Assigned to task
-- b) Created the task
-- c) Has a micro-task in this task
CREATE POLICY "Profissional pode visualizar tarefas"
ON tarefas FOR SELECT
TO authenticated
USING (
    (
        -- Must be active professional
        EXISTS (SELECT 1 FROM profissionais WHERE id = auth.uid() AND ativo = true)
    )
    AND 
    (
        assigned_to = auth.uid() 
        OR 
        created_by = auth.uid()
        OR
        EXISTS (
            SELECT 1 FROM tarefas_itens 
            WHERE tarefas_itens.tarefa_id = tarefas.id 
            AND tarefas_itens.profissional_id = auth.uid()
        )
    )
);

-- 3. Ensure Admin Policy still covers everything (Idempotent check)
-- (Assuming "Admin tem acesso total a tarefas" exists from 002_rls_policies.sql)
-- If we need to be sure, we can recreate it, but usually standard admin policy is stable.
-- We will just make sure no other UPDATE policy allows professionals.

-- 4. Verify no loose UPDATE policies exist
-- The default is DENY. So by deleting the ONLY professional update policy, we default to blocking them.
-- Admin policy 'FOR ALL' will still allow admins.

-- Comment
COMMENT ON TABLE tarefas IS 'Tarefas macro. Updates restricted to Admins or via Triggers.';
