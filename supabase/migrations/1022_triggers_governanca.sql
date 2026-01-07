-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- Migration 1022: Triggers para Eventos de Governança
-- Data: 2026-01-07
-- Descrição: Captura alterações em prazo, título e responsável
--            Garante auditoria mesmo em updates diretos
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

BEGIN;

CREATE OR REPLACE FUNCTION registrar_alteracoes_tarefa()
RETURNS TRIGGER
SECURITY DEFINER
AS $$
DECLARE
    v_user_id UUID;
    v_dados JSONB;
BEGIN
    -- Tentar identificar o usuário (falha graciosa se não houver sessão)
    BEGIN
        v_user_id := auth.uid();
    EXCEPTION WHEN OTHERS THEN
        v_user_id := NULL;
    END;

    -- 1. Prazo Alterado
    IF (OLD.deadline IS DISTINCT FROM NEW.deadline) THEN
        INSERT INTO os_eventos (os_id, tipo, autor_id, metadata)
        VALUES (
            NEW.id, 
            'prazo_alterado', 
            v_user_id,
            jsonb_build_object(
                'de', OLD.deadline,
                'para', NEW.deadline,
                'origem', 'trigger'
            )
        );
    END IF;

    -- 2. Título Alterado
    IF (OLD.titulo IS DISTINCT FROM NEW.titulo) THEN
        INSERT INTO os_eventos (os_id, tipo, autor_id, metadata)
        VALUES (
            NEW.id, 
            'titulo_alterado', 
            v_user_id,
            jsonb_build_object(
                'de', OLD.titulo,
                'para', NEW.titulo,
                'origem', 'trigger'
            )
        );
    END IF;

    -- 3. Responsável Reatribuído
    IF (OLD.assigned_to IS DISTINCT FROM NEW.assigned_to) THEN
        INSERT INTO os_eventos (os_id, tipo, autor_id, metadata)
        VALUES (
            NEW.id, 
            'responsavel_reatribuido', 
            v_user_id,
            jsonb_build_object(
                'de', OLD.assigned_to,
                'para', NEW.assigned_to,
                'origem', 'trigger'
            )
        );
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger unificado para alterações de dados
CREATE TRIGGER trigger_dados_alterados
AFTER UPDATE ON tarefas
FOR EACH ROW
WHEN (
    OLD.deadline IS DISTINCT FROM NEW.deadline OR
    OLD.titulo IS DISTINCT FROM NEW.titulo OR
    OLD.assigned_to IS DISTINCT FROM NEW.assigned_to
)
EXECUTE FUNCTION registrar_alteracoes_tarefa();

-- Comentário
COMMENT ON TRIGGER trigger_dados_alterados ON tarefas IS 'ETAPA 4: Captura alterações de governança (prazo, título, responsável) e registra em os_eventos';

-- Log
DO $$
BEGIN
    RAISE NOTICE '✅ Migration 1022: Triggers de governança criados';
END $$;

COMMIT;
