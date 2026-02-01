-- Fix RLS policy to allow staff to view macro tasks they have micro tasks for
-- This updates the SELECT policy to check both tarefas_itens (old) and tarefas_micro (new)

DROP POLICY IF EXISTS "Profissional pode visualizar tarefas" ON tarefas;

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
        -- Legacy micro tasks (tarefas_itens)
        EXISTS (
            SELECT 1 FROM tarefas_itens 
            WHERE tarefas_itens.tarefa_id = tarefas.id 
            AND tarefas_itens.profissional_id = auth.uid()
        )
        OR
        -- NEW: Micro tasks (tarefas_micro)
        EXISTS (
            SELECT 1 FROM tarefas_micro 
            WHERE tarefas_micro.tarefa_id = tarefas.id 
            AND tarefas_micro.profissional_id = auth.uid()
        )
    )
);
