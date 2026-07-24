-- Função Segura para verificar se o profissional atua em alguma micro tarefa da OS, ignorando o RLS de tarefas_micro
CREATE OR REPLACE FUNCTION public.fn_check_is_micro_task_assigned_safe(target_os_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1
        FROM tarefas_micro
        WHERE tarefa_id = target_os_id
        AND profissional_id = auth.uid()
    );
END;
$$;

-- Recriar as Policies de TAREFAS usando a função Safe
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
  OR public.fn_check_is_micro_task_assigned_safe(id)
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
  OR public.fn_check_is_micro_task_assigned_safe(id)
);

-- Recriar as Policies de TAREFAS_MICRO usando a função Safe de OS Creator
DROP POLICY IF EXISTS "RLS: microtasks visíveis apenas para envolvidos" ON public.tarefas_micro;
DROP POLICY IF EXISTS "RLS: modificar microtasks apenas envolvidos" ON public.tarefas_micro;

CREATE POLICY "RLS: microtasks visíveis apenas para envolvidos"
ON public.tarefas_micro
FOR SELECT
TO authenticated
USING (
  public.is_admin_safe()
  OR public.is_super_admin()
  OR profissional_id = auth.uid()
  OR public.fn_check_is_os_creator_safe(tarefa_id)
);

CREATE POLICY "RLS: modificar microtasks apenas envolvidos"
ON public.tarefas_micro
FOR UPDATE
TO authenticated
USING (
  public.is_admin_safe()
  OR public.is_super_admin()
  OR profissional_id = auth.uid()
  OR public.fn_check_is_os_creator_safe(tarefa_id)
);;
