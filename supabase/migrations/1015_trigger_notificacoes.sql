-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- Migration 1015: Trigger criar_notificacoes
-- Data: 2026-01-07
-- Descrição: Criar notificações automaticamente quando eventos relevantes
--            ocorrem, notificando participantes EXCETO o autor do evento.
--            CORE da ETAPA 3.
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

BEGIN;

-- Função trigger: Criar notificações para eventos
CREATE OR REPLACE FUNCTION criar_notificacoes_evento()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    participante RECORD;
    titulo_notif TEXT;
    mensagem_notif TEXT;
    deve_notificar BOOLEAN;
BEGIN
    -- Determinar se deve notificar baseado no tipo de evento
    deve_notificar := CASE NEW.tipo
        WHEN 'comentario_adicionado' THEN TRUE
        WHEN 'status_alterado' THEN TRUE
        WHEN 'profissional_atribuido' THEN TRUE
        ELSE FALSE
    END CASE;
    
    IF NOT deve_notificar THEN
        RETURN NEW;
    END IF;
    
    -- Montar texto da notificação baseado no tipo
    CASE NEW.tipo
        WHEN 'comentario_adicionado' THEN
            titulo_notif := 'Novo comentário';
            mensagem_notif := NEW.metadata->>'preview';
            
        WHEN 'status_alterado' THEN
            titulo_notif := 'Status atualizado';
            mensagem_notif := format('De "%s" para "%s"', 
                NEW.metadata->>'de', 
                NEW.metadata->>'para');
                
        WHEN 'profissional_atribuido' THEN
            titulo_notif := 'Você foi atribuído';
            mensagem_notif := 'Nova OS atribuída a você';
            
        ELSE
            titulo_notif := 'Atualização na OS';
            mensagem_notif := NULL;
    END CASE;
    
    -- Notificar participantes (EXCETO o autor do evento)
    FOR participante IN
        SELECT DISTINCT p.id
        FROM profissionais p
        INNER JOIN tarefas t ON t.id = NEW.os_id
        WHERE (
            -- Criador da OS
            t.created_by = p.id
            OR
            -- Atribuído direto
            t.assigned_to = p.id
            OR
            -- Atribuído via micro-task
            EXISTS (
                SELECT 1 FROM tarefas_micro tm
                WHERE tm.tarefa_id = t.id 
                AND tm.profissional_id = p.id
            )
        )
        -- EXCLUIR o autor do evento (não notificar a si mesmo)
        AND p.id != COALESCE(NEW.autor_id, '00000000-0000-0000-0000-000000000000'::uuid)
        AND p.ativo = true
    LOOP
        INSERT INTO notificacoes (
            profissional_id, 
            evento_id, 
            os_id, 
            tipo, 
            titulo, 
            mensagem
        ) VALUES (
            participante.id, 
            NEW.id, 
            NEW.os_id, 
            NEW.tipo::VARCHAR, 
            titulo_notif, 
            mensagem_notif
        );
    END LOOP;
    
    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Falha ao criar notificações para evento %: %', NEW.id, SQLERRM;
    RETURN NEW; -- Não bloqueia criação do evento
END;
$$ LANGUAGE plpgsql;

-- Criar trigger
DROP TRIGGER IF EXISTS trigger_notificacoes_evento ON os_eventos;

CREATE TRIGGER trigger_notificacoes_evento
    AFTER INSERT ON os_eventos
    FOR EACH ROW
    EXECUTE FUNCTION criar_notificacoes_evento();

-- Comentários
COMMENT ON FUNCTION criar_notificacoes_evento IS 'ETAPA 3 CORE: Cria notificações automaticamente para participantes da OS (exceto autor do evento).';

-- Log
DO $$
BEGIN
    RAISE NOTICE '✅ Migration 1015: Trigger notificacoes criado (cascata automática)';
END $$;

COMMIT;
