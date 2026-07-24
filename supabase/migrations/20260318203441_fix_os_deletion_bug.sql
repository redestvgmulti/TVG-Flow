-- Remover política anterior que causava o bloqueio silencioso (0 rows deleted)
DROP POLICY IF EXISTS "RLS: modificar apenas envolvidos" ON public.tarefas;
DROP POLICY IF EXISTS "Admins and creators can delete tasks" ON public.tarefas;

-- Criar policy atualizada
CREATE POLICY "RLS: admin ou envolvidos podem modificar"
ON public.tarefas
FOR ALL
USING (
  public.is_admin_safe() 
  OR public.is_super_admin()
  OR created_by = auth.uid()
  OR public.is_user_assigned_to_task(tarefas.id)
)
WITH CHECK (
  public.is_admin_safe() 
  OR public.is_super_admin()
  OR created_by = auth.uid()
  OR public.is_user_assigned_to_task(tarefas.id)
);;
