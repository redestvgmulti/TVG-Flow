-- ==============================================================================
-- FASE 1: DATA MIGRATION (LIMPEZA DE RETROSPECTO)
-- ==============================================================================
-- Injeta o empresa_id nas tarefas baseado no cliente correspondente
UPDATE public.tarefas t
SET empresa_id = c.empresa_id
FROM public.clientes c
WHERE t.cliente_id = c.id
  AND t.empresa_id IS NULL;


-- ==============================================================================
-- FASE 2: ENFORCEMENT & PROTEÇÃO DE UPDATE EM tarefas
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.tg_tarefas_enforce_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Regra A: Herança Automática e Invariável
  IF NEW.cliente_id IS NOT NULL THEN
     SELECT empresa_id INTO NEW.empresa_id 
     FROM public.clientes 
     WHERE id = NEW.cliente_id;
  END IF;

  -- Regra B: Nunca nulo
  IF NEW.empresa_id IS NULL THEN
     RAISE EXCEPTION 'ALERTA DE SEGURANÇA (INVARIANTE QUEBRADA): Uma tarefa não pode ser criada sem empresa_id explícito ou inferido pelo cliente_id.';
  END IF;

  -- Regra C: Mutabilidade Bloqueada (Update Perigoso)
  IF TG_OP = 'UPDATE' THEN
     -- Bloqueia a troca de Empresa (Tenant)
     IF OLD.empresa_id IS DISTINCT FROM NEW.empresa_id THEN
         RAISE EXCEPTION 'CROSS-TENANT FAULT: Não é permitido transferir o tenant (empresa_id) de uma tarefa já criada.';
     END IF;
     
     -- Bloqueia a troca para um Cliente que pertença a OUTRA empresa
     IF OLD.cliente_id IS DISTINCT FROM NEW.cliente_id THEN
         DECLARE 
            novo_cliente_emp_id uuid;
         BEGIN
            SELECT empresa_id INTO novo_cliente_emp_id FROM public.clientes WHERE id = NEW.cliente_id;
            IF novo_cliente_emp_id IS DISTINCT FROM OLD.empresa_id THEN
               RAISE EXCEPTION 'CROSS-TENANT FAULT: O novo cliente pertence a um tenant diferente do tenant original da OS.';
            END IF;
         END;
     END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_enforce_tenant_tarefas ON public.tarefas;
CREATE TRIGGER tr_enforce_tenant_tarefas
BEFORE INSERT OR UPDATE ON public.tarefas
FOR EACH ROW
EXECUTE FUNCTION public.tg_tarefas_enforce_tenant();


-- ==============================================================================
-- FASE 3: PROTEÇÃO DE MICRO-TASK (tarefas_micro)
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.tg_tarefas_micro_enforce_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_tarefa_empresa_id uuid;
  v_profissional_tem_acesso boolean;
BEGIN
  -- 1. Recupera o Tenant da Tarefa Principal OBRIGATORIAMENTE
  SELECT empresa_id INTO v_tarefa_empresa_id 
  FROM public.tarefas 
  WHERE id = NEW.tarefa_id;

  IF v_tarefa_empresa_id IS NULL THEN
     RAISE EXCEPTION 'FALHA DE INTEGRIDADE: A OS Base não tem um tenant válido. Impossível criar micro-task.';
  END IF;

  -- Se um profissional está sendo atribuído
  IF NEW.profissional_id IS NOT NULL THEN
      -- 2. Checa se o Funcionário está ATIVAMENTE ligado ao Tenant daquela Tarefa
      SELECT EXISTS(
         SELECT 1 FROM public.empresa_profissionais
         WHERE profissional_id = NEW.profissional_id
           AND empresa_id = v_tarefa_empresa_id
           AND ativo = true
      ) INTO v_profissional_tem_acesso;

      IF NOT v_profissional_tem_acesso THEN
         RAISE EXCEPTION 'ACESSO NEGADO: Profissional assinalado não pertence ativamente ao Tenant da OS principal.';
      END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_enforce_tenant_tarefas_micro ON public.tarefas_micro;
CREATE TRIGGER tr_enforce_tenant_tarefas_micro
BEFORE INSERT OR UPDATE OF profissional_id, tarefa_id ON public.tarefas_micro
FOR EACH ROW
EXECUTE FUNCTION public.tg_tarefas_micro_enforce_tenant();


-- ==============================================================================
-- FASE 4: CONSTRAINTS ESTRUTURAIS
-- ==============================================================================
-- Trava em nível de schema para garantir a Invariante 1 de forma estrita
ALTER TABLE public.tarefas 
ALTER COLUMN empresa_id SET NOT NULL;


-- ==============================================================================
-- FASE 5: RLS SIMPLIFICADA E RESTRITA (O(1) Access)
-- ==============================================================================

-- Remover antigas policies verbosas
DROP POLICY IF EXISTS "Global Constraint: Tenant Isolation for Admins" ON public.tarefas;
DROP POLICY IF EXISTS "Professionals can update accessible tasks" ON public.tarefas;

-- Criar a nova Policy Restritiva Canônica (Tarefas)
CREATE POLICY "Tenant Based Access"
ON public.tarefas
AS RESTRICTIVE
FOR ALL
TO authenticated
USING (
   empresa_id IN (
       SELECT ep.empresa_id
       FROM public.empresa_profissionais ep
       WHERE ep.profissional_id = auth.uid() AND ep.ativo = true
   )
)
WITH CHECK (
   empresa_id IN (
       SELECT ep.empresa_id
       FROM public.empresa_profissionais ep
       WHERE ep.profissional_id = auth.uid() AND ep.ativo = true
   )
);

-- Limpar e Simplificar RLS de Tarefas Micro
DROP POLICY IF EXISTS "Global Constraint: Tenant Isolation for Admins" ON public.tarefas_micro;
DROP POLICY IF EXISTS "Admin tem acesso total a tarefas_micro" ON public.tarefas_micro;

CREATE POLICY "Tenant Based Access"
ON public.tarefas_micro
AS RESTRICTIVE
FOR ALL
TO authenticated
USING (
   tarefa_id IN (
       SELECT t.id FROM public.tarefas t 
       WHERE t.empresa_id IN (
           SELECT ep.empresa_id FROM public.empresa_profissionais ep 
           WHERE ep.profissional_id = auth.uid() AND ep.ativo = true
       )
   )
)
WITH CHECK (
   tarefa_id IN (
       SELECT t.id FROM public.tarefas t 
       WHERE t.empresa_id IN (
           SELECT ep.empresa_id FROM public.empresa_profissionais ep 
           WHERE ep.profissional_id = auth.uid() AND ep.ativo = true
       )
   )
);


-- ==============================================================================
-- FASE 6: PERFORMANCE / ÍNDICES
-- ==============================================================================
CREATE INDEX IF NOT EXISTS idx_empresa_profissionais_prof_ativo ON public.empresa_profissionais (profissional_id, ativo, empresa_id);
CREATE INDEX IF NOT EXISTS idx_tarefas_empresa_id ON public.tarefas (empresa_id);
