-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- MIGRATION: FASE 5 - PERMISSION HELPERS (CORRECTED)
-- DATE: 2026-01-23
-- DESCRIPTION: Cria funções helper para uso exclusivo do frontend.
--              ESTA VERSÃO SEGUE ESTRITAMENTE A LÓGICA DAS RPCs.
--              Sem inferências, sem helpers implícitos.
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- 1. Helper: can_create_os
-- Semântica: Indica se o usuário pode INICIAR a criação de uma OS.
-- Regras:
--   - Super Admin: FALSE immediately.
--   - Tenant x Cliente: Cliente DEVE pertencer ao Tenant da OS.
--   - Usuário x Tenant: Usuário DEVE ter vínculo ativo com o Tenant da OS.
-- Add explicit drop to avoid return type conflict
DROP FUNCTION IF EXISTS public.can_create_os(UUID, UUID);
CREATE OR REPLACE FUNCTION public.can_create_os(p_empresa_id UUID, p_cliente_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
    v_user_role TEXT;
    v_cliente_empresa_id UUID;
BEGIN
    -- 1. Identificar Role diretamente na tabela (Source of Truth)
    SELECT role INTO v_user_role FROM public.profissionais WHERE id = auth.uid();

    -- REGRA: Super Admin nunca cria OS
    IF v_user_role = 'super_admin' THEN
        RETURN FALSE;
    END IF;

    -- REGRA: Validação de integridade do Cliente
    SELECT empresa_id INTO v_cliente_empresa_id FROM public.clientes WHERE id = p_cliente_id;
    
    -- Se cliente não existe ou não pertence ao Tenant solicitado -> FALSE
    IF v_cliente_empresa_id IS NULL OR v_cliente_empresa_id != p_empresa_id THEN
        RETURN FALSE;
    END IF;

    -- REGRA: Usuário deve ter vínculo ATIVO com o Tenant solicidado
    PERFORM 1 FROM public.empresa_profissionais
    WHERE profissional_id = auth.uid() 
      AND empresa_id = p_empresa_id 
      AND ativo = true;
    
    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;

    RETURN TRUE;
END;
$$;

-- 2. Helper: can_create_workflow_os
-- Semântica: Indica se o usuário pode criar OS com Workflow (Múltiplas Etapas).
-- Regras: 
--   - Mesmas validações de 'can_create_os'
--   - ADICIONAL: Usuário deve ser 'admin'.
-- Add explicit drop to avoid return type conflict
DROP FUNCTION IF EXISTS public.can_create_workflow_os(UUID, UUID);
CREATE OR REPLACE FUNCTION public.can_create_workflow_os(p_empresa_id UUID, p_cliente_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
    v_user_role TEXT;
    v_cliente_empresa_id UUID;
BEGIN
    -- 1. Identificar Role
    SELECT role INTO v_user_role FROM public.profissionais WHERE id = auth.uid();

    -- REGRA: Apenas Admin cria workflow
    IF v_user_role != 'admin' THEN
        RETURN FALSE;
    END IF;

    -- REGRA: Validação de Cliente (Integridade)
    SELECT empresa_id INTO v_cliente_empresa_id FROM public.clientes WHERE id = p_cliente_id;
    IF v_cliente_empresa_id IS NULL OR v_cliente_empresa_id != p_empresa_id THEN
        RETURN FALSE;
    END IF;

    -- REGRA: Vínculo Ativo com Tenant
    PERFORM 1 FROM public.empresa_profissionais
    WHERE profissional_id = auth.uid() 
      AND empresa_id = p_empresa_id 
      AND ativo = true;
      
    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;

    RETURN TRUE;
END;
$$;

-- 3. Helper: can_assign_professional
-- Semântica: Indica se o usuário LOGADO pode atribuir o profissional ALVO para a FUNÇÃO no CLIENTE.
-- Regras (Espelho create_os_with_micro_tasks V4.1):
--   A) TRUE se existir vínculo explícito em cliente_profissionais.
--   B) TRUE se (Admin Logado + Auto-Atribuição).
-- Add explicit drop to avoid return type conflict
DROP FUNCTION IF EXISTS public.can_assign_professional(UUID, UUID, TEXT);
CREATE OR REPLACE FUNCTION public.can_assign_professional(p_cliente_id UUID, p_profissional_id UUID, p_funcao TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
    v_user_role TEXT;
BEGIN
    -- 1. Role do usuário LOGADO (quem opera a UI)
    SELECT role INTO v_user_role FROM public.profissionais WHERE id = auth.uid();

    -- REGRA A: Função Explícita
    IF EXISTS (
        SELECT 1 FROM public.cliente_profissionais
        WHERE profissional_id = p_profissional_id
          AND cliente_id = p_cliente_id
          AND funcao = p_funcao
          AND ativo = true
    ) THEN
        RETURN TRUE;
    END IF;

    -- REGRA B: Bypass de Admin (Auto-Atribuição)
    IF (v_user_role = 'admin' AND p_profissional_id = auth.uid()) THEN
        -- Validação adicional exigida no prompt:
        -- Verificar se o cliente pertence a uma empresa onde este admin tem vínculo ativo.
        -- (Isso garante que o admin não está se atribuindo a um cliente de outro tenant)
        IF EXISTS (
            SELECT 1 FROM public.clientes c
            JOIN public.empresa_profissionais ep ON ep.empresa_id = c.empresa_id
            WHERE c.id = p_cliente_id
              AND ep.profissional_id = auth.uid()
) THEN
            RETURN TRUE;
        END IF;
    END IF;

    RETURN FALSE;
END;
$$;

-- 4. Helper: can_view_cliente
-- Semântica: Visibilidade estrutural do cliente.
-- Regras: Super Admin (Sim), Admin (Seu Tenant), Staff (Não).
-- Add explicit drop to avoid return type conflict
DROP FUNCTION IF EXISTS public.can_view_cliente(UUID);
CREATE OR REPLACE FUNCTION public.can_view_cliente(p_cliente_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
    v_user_role TEXT;
BEGIN
    -- Super Admin: Acesso total (evita queries desnecessárias se confiarmos na role, mas vamos checar a role no banco para ter certeza)
    -- Para segurança máxima e evitar função helper implícita, lemos a role:
    SELECT role INTO v_user_role FROM public.profissionais WHERE id = auth.uid();
    
    IF v_user_role = 'super_admin' THEN
        RETURN TRUE;
    END IF;

    -- Staff: Não tem acesso a ver dados "do cliente" (apenas tarefas)
    IF v_user_role = 'staff' THEN
        RETURN FALSE;
    END IF;

    -- Admin: Vê se cliente pertence a um tenant onde ele tem vínculo ativo
    IF v_user_role = 'admin' THEN
        RETURN EXISTS (
            SELECT 1 FROM public.clientes c
            JOIN public.empresa_profissionais ep ON ep.empresa_id = c.empresa_id
            WHERE c.id = p_cliente_id
              AND ep.profissional_id = auth.uid()
);
    END IF;

    RETURN FALSE;
END;
$$;

-- Grant Permissions
GRANT EXECUTE ON FUNCTION public.can_create_os(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_create_workflow_os(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_assign_professional(UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_cliente(UUID) TO authenticated;
