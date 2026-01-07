-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- Migration 1013: Trigger status_alterado
-- Data: 2026-01-07
-- Descrição: Registrar evento automático quando status da OS é alterado.
--            CORE da ETAPA 3.
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

BEGIN;

-- Função trigger: Registrar evento quando status muda
CREATE OR REPLACE FUNCTION registrar_evento_status_alterado()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Apenas se status mudou de fato
    IF OLD.status IS DISTINCT FROM NEW.status THEN
        INSERT INTO os_eventos (os_id, tipo, autor_id, metadata)
        VALUES (
            NEW.id,
            'status_alterado',
            NULL, -- ✅ Sistema (não sabemos quem alterou específicamente)
            jsonb_build_object(
                'de', OLD.status,
                'para', NEW.status
            )
        );
    END IF;
    
    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Falha ao registrar evento status_alterado para OS %: %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Criar trigger
DROP TRIGGER IF EXISTS trigger_status_alterado ON tarefas;

CREATE TRIGGER trigger_status_alterado
    AFTER UPDATE ON tarefas
    FOR EACH ROW
    EXECUTE FUNCTION registrar_evento_status_alterado();

-- Comentários
COMMENT ON FUNCTION registrar_evento_status_alterado IS 'ETAPA 3 CORE: Registra evento status_alterado quando status muda. autor_id = NULL (sistema).';

-- Log
DO $$
BEGIN
    RAISE NOTICE '✅ Migration 1013: Trigger status_alterado criado (evento automático)';
END $$;

COMMIT;
