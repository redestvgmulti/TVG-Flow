-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- Migration 1019: Criar funções de permissão (ETAPA 4)
-- Data: 2026-01-07
-- Descrição: Funções helper SECURITY DEFINER para validar permissões
--            Centraliza lógica de governança
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

BEGIN;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 1. can_change_deadline: Verificar se usuário pode alterar prazo
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE OR REPLACE FUNCTION can_change_deadline(
    p_os_id UUID,
    p_user_id UUID
)
RETURNS BOOLEAN
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    os_record RECORD;
BEGIN
    -- Buscar dados da OS
    SELECT status, created_by, deleted_at
    INTO os_record
    FROM tarefas 
    WHERE id = p_os_id;
    
    -- OS não encontrada ou excluída
    IF os_record IS NULL OR os_record.deleted_at IS NOT NULL THEN
        RETURN FALSE;
    END IF;
    
    -- Admin sempre pode (se ativa)
    IF is_admin_safe() THEN
        RETURN TRUE;
    END IF;
    
    -- Criador pode se pendente
    IF os_record.created_by = p_user_id 
       AND os_record.status = 'pendente' THEN
        RETURN TRUE;
    END IF;
    
    RETURN FALSE;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION can_change_deadline IS 'ETAPA 4: Verifica se p_user_id pode alterar deadline da OS. Admin sempre pode, Criador apenas se pendente';

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 2. can_convert_to_complex: Verificar se pode converter OS → complexa
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE OR REPLACE FUNCTION can_convert_to_complex(
    p_os_id UUID,
    p_user_id UUID
)
RETURNS BOOLEAN
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    os_record RECORD;
BEGIN
    -- Apenas admin
    IF NOT is_admin_safe() THEN
        RETURN FALSE;
    END IF;
    
    -- Buscar dados da OS
    SELECT status, has_micro_tasks, deleted_at
    INTO os_record
    FROM tarefas 
    WHERE id = p_os_id;
    
    -- OS não encontrada ou excluída
    IF os_record IS NULL OR os_record.deleted_at IS NOT NULL THEN
        RETURN FALSE;
    END IF;
    
    -- Não pode estar concluída
    IF os_record.status IN ('concluida', 'cancelada') THEN
        RETURN FALSE;
    END IF;
    
    -- Não pode já ser complexa
    IF os_record.has_micro_tasks = TRUE THEN
        RETURN FALSE;
    END IF;
    
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION can_convert_to_complex IS 'ETAPA 4: Verifica se p_user_id pode converter OS em complexa. Apenas admin, e OS não pode estar concluída ou já ser complexa';

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 3. can_delete_os: Verificar se pode excluir OS (soft delete)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE OR REPLACE FUNCTION can_delete_os(
    p_os_id UUID,
    p_user_id UUID
)
RETURNS BOOLEAN
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    os_record RECORD;
    event_count INT;
BEGIN
    -- Buscar dados da OS
    SELECT status, created_by, deleted_at
    INTO os_record
    FROM tarefas 
    WHERE id = p_os_id;
    
    -- OS não encontrada ou já excluída
    IF os_record IS NULL OR os_record.deleted_at IS NOT NULL THEN
        RETURN FALSE;
    END IF;
    
    -- Admin sempre pode
    IF is_admin_safe() THEN
        RETURN TRUE;
    END IF;
    
    -- Criador pode se pendente E sem atividade além de os_criada
    IF os_record.created_by = p_user_id 
       AND os_record.status = 'pendente' THEN
        
        -- Contar eventos (além de os_criada)
        SELECT COUNT(*) INTO event_count
        FROM os_eventos
        WHERE os_id = p_os_id
        AND tipo != 'os_criada';
        
        -- Permitir apenas se sem atividade
        IF event_count = 0 THEN
            RETURN TRUE;
        END IF;
    END IF;
    
    RETURN FALSE;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION can_delete_os IS 'ETAPA 4: Verifica se p_user_id pode excluir OS. Admin sempre pode, Criador apenas se pendente e sem atividade (eventos além de os_criada)';

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 4. can_add_micro_tasks: Verificar se pode adicionar micro-tasks
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE OR REPLACE FUNCTION can_add_micro_tasks(
    p_os_id UUID,
    p_user_id UUID
)
RETURNS BOOLEAN
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    os_record RECORD;
BEGIN
    -- Apenas admin
    IF NOT is_admin_safe() THEN
        RETURN FALSE;
    END IF;
    
    -- Buscar dados da OS
    SELECT status, has_micro_tasks, deleted_at
    INTO os_record
    FROM tarefas 
    WHERE id = p_os_id;
    
    -- OS não encontrada ou excluída
    IF os_record IS NULL OR os_record.deleted_at IS NOT NULL THEN
        RETURN FALSE;
    END IF;
    
    -- Não pode estar concluída
    IF os_record.status IN ('concluida', 'cancelada') THEN
        RETURN FALSE;
    END IF;
    
    -- Deve ser complexa (ou em processo de conversão)
    IF os_record.has_micro_tasks = FALSE THEN
        RETURN FALSE;
    END IF;
    
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION can_add_micro_tasks IS 'ETAPA 4: Verifica se p_user_id pode adicionar micro-tasks. Apenas admin, e OS deve ser complexa e não estar concluída';

-- Log
DO $$
BEGIN
    RAISE NOTICE '✅ Migration 1019: Funções de permissão criadas (ETAPA 4)';
END $$;

COMMIT;
