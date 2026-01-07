-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- Migration 1014: Trigger comentario_adicionado
-- Data: 2026-01-07
-- Descrição: Registrar evento automático quando comentário é adicionado.
--            CORE da ETAPA 3.
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

BEGIN;

-- Função trigger: Registrar evento quando comentário é criado
CREATE OR REPLACE FUNCTION registrar_evento_comentario()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Inserir evento na timeline
    INSERT INTO os_eventos (os_id, tipo, autor_id, metadata)
    VALUES (
        NEW.task_id, -- task_comments usa 'task_id' como FK
        'comentario_adicionado',
        NEW.author_id, -- ✅ Autor do comentário (campo persistido)
        jsonb_build_object(
            'comentario_id', NEW.id,
            'preview', LEFT(NEW.content, 100) -- Preview de 100 chars
        )
    );
    
    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Falha ao registrar evento comentario para task %: %', NEW.task_id, SQLERRM;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Criar trigger
DROP TRIGGER IF EXISTS trigger_comentario_adicionado ON task_comments;

CREATE TRIGGER trigger_comentario_adicionado
    AFTER INSERT ON task_comments
    FOR EACH ROW
    EXECUTE FUNCTION registrar_evento_comentario();

-- Comentários
COMMENT ON FUNCTION registrar_evento_comentario IS 'ETAPA 3 CORE: Registra evento comentario_adicionado automaticamente. Usa NEW.author_id.';

-- Log
DO $$
BEGIN
    RAISE NOTICE '✅ Migration 1014: Trigger comentario_adicionado criado (evento automático)';
END $$;

COMMIT;
