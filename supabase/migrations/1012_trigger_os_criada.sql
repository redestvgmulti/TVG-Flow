-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- Migration 1012: Trigger os_criada
-- Data: 2026-01-07
-- Descrição: Registrar evento automático quando uma OS é criada.
--            CORE da ETAPA 3.
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

BEGIN;

-- Função trigger: Registrar evento quando OS é criada
CREATE OR REPLACE FUNCTION registrar_evento_os_criada()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Inserir evento na timeline
    INSERT INTO os_eventos (os_id, tipo, autor_id, metadata)
    VALUES (
        NEW.id,
        'os_criada',
        NEW.created_by, -- ✅ Usa campo persistido, NÃO auth.uid()
        jsonb_build_object(
            'titulo', NEW.titulo,
            'prioridade', NEW.prioridade,
            'deadline', NEW.deadline
        )
    );
    
    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    -- Log erro mas não bloqueia criação da OS
    RAISE WARNING 'Falha ao registrar evento os_criada para OS %: %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Criar trigger
DROP TRIGGER IF EXISTS trigger_os_criada ON tarefas;

CREATE TRIGGER trigger_os_criada
    AFTER INSERT ON tarefas
    FOR EACH ROW
    EXECUTE FUNCTION registrar_evento_os_criada();

-- Comentários
COMMENT ON FUNCTION registrar_evento_os_criada IS 'ETAPA 3 CORE: Registra evento os_criada automaticamente. Usa NEW.created_by (não auth.uid).';

-- Log
DO $$
BEGIN
    RAISE NOTICE '✅ Migration 1012: Trigger os_criada criado (evento automático)';
END $$;

COMMIT;
