-- ==============================================================================
-- CORREÇÃO CRÍTICA DE RLS - RECURSÃO INFINITA (42P17)
-- Estratégia Aprovada: Bypass Seguro via SECURITY DEFINER
-- ==============================================================================

-- 1. CRIAR FUNÇÃO SEGURA DE ACESSO AO TENANT
-- Retorna o empresa_id da tarefa ignorando RLS para evitar o loop.
-- O search_path é fixado para public para prevenir privilege escalation.
CREATE OR REPLACE FUNCTION public.get_tarefa_empresa_id_safe(p_tarefa_id UUID)
RETURNS UUID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT empresa_id FROM public.tarefas WHERE id = p_tarefa_id;
$$;


-- 2. SUBSTITUIR POLICY PROBLEMÁTICA EM tarefas_micro
-- Remove a policy que causava o loop ao consultar 'tarefas' sem bypass.
DROP POLICY IF EXISTS "Tenant Based Access" ON public.tarefas_micro;

-- Cria a policy segura consumindo a função SECURITY DEFINER.
CREATE POLICY "Tenant Based Access Safe"
ON public.tarefas_micro
AS RESTRICTIVE
FOR ALL
TO authenticated
USING (
   public.get_tarefa_empresa_id_safe(tarefa_id) IN (
       SELECT ep.empresa_id FROM public.empresa_profissionais ep 
       WHERE ep.profissional_id = auth.uid() AND ep.ativo = true
   )
)
WITH CHECK (
   public.get_tarefa_empresa_id_safe(tarefa_id) IN (
       SELECT ep.empresa_id FROM public.empresa_profissionais ep 
       WHERE ep.profissional_id = auth.uid() AND ep.ativo = true
   )
);
