-- ==============================================================================
-- CORREÇÃO CRÍTICA DE RLS - DELEÇÃO E EDIÇÃO GLOBAIS DE OS PARA ADMINS
-- Garantir que super_admin e admin tenham permissões irrestritas (CRUD) nas Tarefas
-- ==============================================================================

-- Remover política anterior que causava o bloqueio silencioso (0 rows deleted)
DROP POLICY IF EXISTS "RLS: modificar apenas envolvidos" ON public.tarefas;
DROP POLICY IF EXISTS "Admins and creators can delete tasks" ON public.tarefas;

-- Criar policy atualizada
CREATE POLICY "RLS: admin ou envolvidos podem modificar"
ON public.tarefas
FOR ALL
USING (
  -- Super Admins e Admins do Tenant têm poder global (mesmo se não criaram)
  public.is_admin_safe() 
  OR public.is_super_admin()

  -- Criador da OS tem permissão
  OR created_by = auth.uid()

  -- Profissionais atribuídos ou engajados na OS podem acessar/modificar
  OR public.is_user_assigned_to_task(tarefas.id)
);
