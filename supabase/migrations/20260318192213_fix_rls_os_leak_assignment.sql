-- ==========================================
-- CORREÇÃO CRÍTICA — RLS BASEADO EM ATRIBUIÇÃO
-- ==========================================

-- 1. REMOVER POLICIES VAZADAS NO TAREFAS
DROP POLICY IF EXISTS "Tenant Visibility: Tarefas" ON public.tarefas;
DROP POLICY IF EXISTS "Tenant Modification: Tarefas" ON public.tarefas;

-- 2. NOVA POLICY — SELECT (VISUALIZAÇÃO)
CREATE POLICY "RLS: tarefas visíveis apenas para envolvidos"
ON public.tarefas
FOR SELECT
USING (
  public.is_admin_safe()
  OR public.is_super_admin()
  OR created_by = auth.uid()
  OR assigned_to = auth.uid()
  OR EXISTS (
    SELECT 1
    FROM public.tarefas_micro tm
    WHERE tm.tarefa_id = id
      AND tm.profissional_id = auth.uid()
  )
);

-- 3. POLICY — UPDATE (MODIFICAÇÃO)
CREATE POLICY "RLS: modificar apenas envolvidos"
ON public.tarefas
FOR UPDATE
USING (
  public.is_admin_safe()
  OR public.is_super_admin()
  OR created_by = auth.uid()
  OR assigned_to = auth.uid()
  OR EXISTS (
    SELECT 1
    FROM public.tarefas_micro tm
    WHERE tm.tarefa_id = id
      AND tm.profissional_id = auth.uid()
  )
);

-- 4. REMOVER POLICIES VAZADAS NO TAREFAS_MICRO
DROP POLICY IF EXISTS "Tenant Visibility: Micro Tarefas" ON public.tarefas_micro;
DROP POLICY IF EXISTS "Tenant Modification: Micro Tarefas" ON public.tarefas_micro;
DROP POLICY IF EXISTS "Tenant Visibility: tarefas_micro" ON public.tarefas_micro;

-- 5. RLS PARA TAREFAS_MICRO (VISUALIZAÇÃO)
CREATE POLICY "RLS: microtasks visíveis apenas para envolvidos"
ON public.tarefas_micro
FOR SELECT
USING (
  public.is_admin_safe()
  OR public.is_super_admin()
  OR profissional_id = auth.uid()
  OR EXISTS (
    SELECT 1
    FROM public.tarefas t
    WHERE t.id = tarefa_id
      AND t.created_by = auth.uid()
  )
);

-- 6. RLS PARA TAREFAS_MICRO (MODIFICAÇÃO)
CREATE POLICY "RLS: modificar microtasks apenas envolvidos"
ON public.tarefas_micro
FOR UPDATE
USING (
  public.is_admin_safe()
  OR public.is_super_admin()
  OR profissional_id = auth.uid()
  OR EXISTS (
    SELECT 1
    FROM public.tarefas t
    WHERE t.id = tarefa_id
      AND t.created_by = auth.uid()
  )
);
;
