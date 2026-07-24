DROP POLICY IF EXISTS "RLS: tarefas visíveis apenas para envolvidos" ON public.tarefas;
DROP POLICY IF EXISTS "RLS: modificar apenas envolvidos" ON public.tarefas;

CREATE POLICY "RLS: tarefas visíveis apenas para envolvidos"
ON public.tarefas
FOR SELECT
TO authenticated
USING (
  public.is_admin_safe()
  OR public.is_super_admin()
  OR created_by = auth.uid()
  OR assigned_to = auth.uid()
  OR EXISTS (
    SELECT 1
    FROM public.tarefas_micro tm
    WHERE tm.tarefa_id = tarefas.id
      AND tm.profissional_id = auth.uid()
  )
);

CREATE POLICY "RLS: modificar apenas envolvidos"
ON public.tarefas
FOR UPDATE
TO authenticated
USING (
  public.is_admin_safe()
  OR public.is_super_admin()
  OR created_by = auth.uid()
  OR assigned_to = auth.uid()
  OR EXISTS (
    SELECT 1
    FROM public.tarefas_micro tm
    WHERE tm.tarefa_id = tarefas.id
      AND tm.profissional_id = auth.uid()
  )
);
;
