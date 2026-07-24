-- ==============================================================================
-- CORREÇÃO CRÍTICA DE RLS
-- Permite que admins, criador, responsável direto e participantes do workflow
-- modifiquem tarefas às quais realmente pertencem.
-- ==============================================================================

DROP POLICY IF EXISTS "RLS: modificar apenas envolvidos"
    ON public.tarefas;

DROP POLICY IF EXISTS "Admins and creators can delete tasks"
    ON public.tarefas;

DROP POLICY IF EXISTS "RLS: admin ou envolvidos podem modificar"
    ON public.tarefas;

CREATE POLICY "RLS: admin ou envolvidos podem modificar"
    ON public.tarefas
    FOR ALL
    TO authenticated
    USING (
        public.is_admin_safe()
        OR public.is_super_admin()
        OR created_by = auth.uid()
        OR assigned_to = auth.uid()
        OR EXISTS (
            SELECT 1
            FROM public.tarefas_micro AS tm
            WHERE tm.tarefa_id = tarefas.id
              AND tm.profissional_id = auth.uid()
        )
    )
    WITH CHECK (
        public.is_admin_safe()
        OR public.is_super_admin()
        OR created_by = auth.uid()
        OR assigned_to = auth.uid()
        OR EXISTS (
            SELECT 1
            FROM public.tarefas_micro AS tm
            WHERE tm.tarefa_id = tarefas.id
              AND tm.profissional_id = auth.uid()
        )
    );
