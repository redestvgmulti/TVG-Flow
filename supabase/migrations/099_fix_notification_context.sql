-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- Migration 999: Fix Generic Notification Context
-- Date: 2026-01-23
-- Description: Updates the 'criar_notificacoes_evento' trigger function to 
--              fetch and include Task Title and Client Name in notification messages.
--              Resolves the regression of "Status atualizado — De 'X' para 'Y'".
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Add explicit drop to avoid return type conflict
DROP FUNCTION IF EXISTS criar_notificacoes_evento() CASCADE;
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
    
    -- Context Variables
    v_task_title TEXT;
    v_client_name TEXT;
    v_old_status TEXT;
    v_new_status TEXT;
BEGIN
    -- 1. Determinar se deve notificar baseado no tipo de evento
    deve_notificar := CASE NEW.tipo
        WHEN 'comentario_adicionado' THEN TRUE
        WHEN 'status_alterado' THEN TRUE
        WHEN 'profissional_atribuido' THEN TRUE
        ELSE FALSE
    END CASE;
    
    IF NOT deve_notificar THEN
        RETURN NEW;
    END IF;

    -- 2. FETCH CONTEXT (Task Title & Client)
    --    Only fetch if we are actually going to verify/notify to save query cost
    IF NEW.os_id IS NOT NULL THEN
        SELECT t.titulo, c.nome
        INTO v_task_title, v_client_name
        FROM tarefas t
        LEFT JOIN clientes c ON c.id = t.cliente_id
        WHERE t.id = NEW.os_id;
    END IF;

    -- Fallbacks for context
    v_task_title := COALESCE(v_task_title, 'Tarefa sem título');
    v_client_name := COALESCE(v_client_name, 'Sem cliente');

    -- 3. Montar texto da notificação (RICH CONTEXT)
    CASE NEW.tipo
        WHEN 'comentario_adicionado' THEN
            titulo_notif := 'Novo comentário';
            mensagem_notif := format('Em: "%s" — %s', v_task_title, NEW.metadata->>'preview');
            
        WHEN 'status_alterado' THEN
            v_old_status := COALESCE(NEW.metadata->>'de', '?');
            v_new_status := COALESCE(NEW.metadata->>'para', '?');
            
            titulo_notif := 'Status atualizado';
            -- RICH MESSAGE: "A tarefa 'Título' (Cliente) mudou de 'x' para 'y'."
            mensagem_notif := format('A tarefa "%s" (%s) mudou de "%s" para "%s".', 
                v_task_title, 
                v_client_name,
                v_old_status, 
                v_new_status);
                
        WHEN 'profissional_atribuido' THEN
            titulo_notif := 'Você foi atribuído';
            mensagem_notif := format('Você foi atribuído à tarefa "%s" (%s).', 
                v_task_title, 
                v_client_name);
            
        ELSE
            titulo_notif := 'Atualização na OS';
            mensagem_notif := format('Atualização na tarefa "%s"', v_task_title);
    END CASE;
    
    -- 4. Notificar participantes
    FOR participante IN
        SELECT DISTINCT p.id
        FROM profissionais p
        INNER JOIN tarefas t ON t.id = NEW.os_id
        WHERE (
            t.created_by = p.id
            OR
            t.assigned_to = p.id
            OR
            EXISTS (
                SELECT 1 FROM tarefas_micro tm
                WHERE tm.tarefa_id = t.id 
                AND tm.profissional_id = p.id
            )
        )
        -- Excluir autor do evento (se existir)
        AND p.id != COALESCE(NEW.autor_id, '00000000-0000-0000-0000-000000000000'::uuid)
        AND p.ativo = true
    LOOP
        INSERT INTO notificacoes (
            profissional_id, 
            evento_id, 
            os_id, 
            tipo, 
            titulo, 
            mensagem,
            metadata,    -- Propagate metadata
            created_at
        ) VALUES (
            participante.id, 
            NEW.id, 
            NEW.os_id, 
            NEW.tipo::VARCHAR, 
            titulo_notif, 
            mensagem_notif,
            NEW.metadata, -- Pass original metadata too
            NOW()
        );
    END LOOP;
    
    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    -- Fail safe
    RAISE WARNING 'Falha ao criar notificações (Fixed Trigger) para evento %: %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
