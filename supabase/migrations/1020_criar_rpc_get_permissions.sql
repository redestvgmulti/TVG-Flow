-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- Migration 1020: Criar RPC get_os_permissions (ETAPA 4)
-- Data: 2026-01-07
-- Descrição: RPC que retorna JSON com todas permissões calculadas
--            para uso no frontend (hook useOSPermissions)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

BEGIN;

-- RPC: Calcular todas permissões para uma OS
CREATE OR REPLACE FUNCTION get_os_permissions(p_os_id UUID)
RETURNS JSON
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    user_id UUID := auth.uid();
    os_record RECORD;
    result JSON;
BEGIN
    -- Buscar dados da OS
    SELECT 
        status, 
        created_by, 
        assigned_to,
        has_micro_tasks,
        deleted_at
    INTO os_record
    FROM tarefas 
    WHERE id = p_os_id;
    
    -- OS não encontrada
    IF os_record IS NULL THEN
        RETURN json_build_object(
            'error', 'OS não encontrada',
            'can_view', false
        );
    END IF;
    
    -- OS excluída
    IF os_record.deleted_at IS NOT NULL THEN
        RETURN json_build_object(
            'error', 'OS excluída',
            'can_view', false,
            'is_deleted', true
        );
    END IF;
    
    -- Calcular permissões
    SELECT json_build_object(
        -- Identificação
        'is_admin', is_admin_safe(),
        'is_creator', os_record.created_by = user_id,
        'is_assigned', os_record.assigned_to = user_id,
        'is_participant', is_os_participant(p_os_id),
        
        -- Estado da OS
        'os_status', os_record.status,
        'is_complex', os_record.has_micro_tasks,
        'is_deleted', os_record.deleted_at IS NOT NULL,
        
        -- Permissões de Visualização
        'can_view', is_os_participant(p_os_id),
        'can_view_timeline', is_os_participant(p_os_id),
        
        -- Permissões de Colaboração
        'can_comment', is_os_participant(p_os_id),
        'can_add_link', (
            is_admin_safe() OR 
            os_record.created_by = user_id OR
            os_record.assigned_to = user_id
        ),
        
        -- Permissões de Execução
        'can_change_status', (
            is_admin_safe() OR 
            (
                (os_record.assigned_to = user_id OR os_record.created_by = user_id)
                AND os_record.status NOT IN ('concluida', 'cancelada')
            )
        ),
        
        -- Permissões de Alteração Leve
        'can_change_title', (
            (is_admin_safe()) OR
            (os_record.created_by = user_id AND os_record.status = 'pendente')
        ),
        'can_change_description', (
            (is_admin_safe()) OR
            (os_record.created_by = user_id AND os_record.status = 'pendente')
        ),
        'can_change_priority', is_admin_safe(),
        'can_change_deadline', can_change_deadline(p_os_id, user_id),
        
        -- Permissões Estruturais
        'can_convert_to_complex', can_convert_to_complex(p_os_id, user_id),
        'can_add_micro_tasks', can_add_micro_tasks(p_os_id, user_id),
        'can_remove_micro_tasks', is_admin_safe(),
        'can_reassign', is_admin_safe(),
        'can_delete', can_delete_os(p_os_id, user_id)
    ) INTO result;
    
    RETURN result;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_os_permissions IS 'ETAPA 4: RPC que calcula todas permissões para uma OS. Retorna JSON com flags booleanas para uso no frontend (hooks React). SECURITY DEFINER para usar funções helper';

-- Log
DO $$
BEGIN
    RAISE NOTICE '✅ Migration 1020: RPC get_os_permissions criado (ETAPA 4)';
END $$;

COMMIT;
