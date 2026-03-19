-- ==============================================================================
-- CORREÇÃO DE RLS - PERMITIR AO ASSIGNED_TO CONCLUIR/MODIFICAR OS SIMPLES
-- A política "ALL" anterior omitiu a checagem do "assigned_to", impedindo que
-- profissionais pudessem finalizar as OS simples que lhe foram atribuídas.
-- ==============================================================================

DROP POLICY IF EXISTS "RLS: admin ou envolvidos podem modificar" ON public.tarefas;

CREATE POLICY "RLS: admin ou envolvidos podem modificar"
ON public.tarefas
FOR ALL
USING (
  public.is_admin_safe() 
  OR public.is_super_admin()
  OR created_by = auth.uid()
  OR assigned_to = auth.uid()
  OR public.is_user_assigned_to_task(id)
)
WITH CHECK (
  public.is_admin_safe() 
  OR public.is_super_admin()
  OR created_by = auth.uid()
  OR assigned_to = auth.uid()
  OR public.is_user_assigned_to_task(id)
);
