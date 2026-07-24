-- 1. FUNÇÃO AUXILIAR (SEM RLS - SECURITY DEFINER)
CREATE OR REPLACE FUNCTION public.is_user_assigned_to_task(task_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM tarefas_micro tm
    WHERE tm.tarefa_id = task_id
      AND tm.profissional_id = auth.uid()
  );
$$;

-- 2. ATUALIZAR POLICY DE tarefas (SELECT e UPDATE)
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
  OR public.is_user_assigned_to_task(id)
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
  OR public.is_user_assigned_to_task(id)
);

-- 3. POLICY DE tarefas_micro (SEM LOOP)
DROP POLICY IF EXISTS "RLS: microtasks visíveis apenas para envolvidos" ON public.tarefas_micro;
DROP POLICY IF EXISTS "RLS: modificar microtasks apenas envolvidos" ON public.tarefas_micro;
DROP POLICY IF EXISTS "RLS: microtasks visíveis" ON public.tarefas_micro;

CREATE POLICY "RLS: microtasks visíveis"
ON public.tarefas_micro
FOR SELECT
TO authenticated
USING (
  public.is_admin_safe()
  OR public.is_super_admin()
  OR profissional_id = auth.uid()
  OR public.fn_check_is_os_creator_safe(tarefa_id)
);

CREATE POLICY "RLS: modificar microtasks"
ON public.tarefas_micro
FOR UPDATE
TO authenticated
USING (
  public.is_admin_safe()
  OR public.is_super_admin()
  OR profissional_id = auth.uid()
);;
