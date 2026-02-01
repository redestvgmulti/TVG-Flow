-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- FEATURE: NOTIFICAÇÃO DE PRESENÇA (RSVP/CHECK-IN)
-- Date: 2026-01-18
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE OR REPLACE FUNCTION notify_meeting_presence(
    p_reuniao_id UUID,
    p_participante_id UUID
)
RETURNS UUID AS $$
DECLARE
    v_reuniao_titulo TEXT;
    v_criador_id UUID;
    v_participante_nome TEXT;
    v_notif_id UUID;
BEGIN
    -- Buscar dados da reunião
    SELECT titulo, criada_por INTO v_reuniao_titulo, v_criador_id
    FROM reunioes WHERE id = p_reuniao_id;
    
    -- Buscar nome do participante
    SELECT nome INTO v_participante_nome
    FROM profissionais WHERE id = p_participante_id;
    
    -- Não notificar se o criador for o próprio participante (auto-confirmação)
    IF v_criador_id = p_participante_id THEN
        RETURN NULL;
    END IF;
    
    IF v_criador_id IS NOT NULL AND v_participante_nome IS NOT NULL THEN
        -- Criar notificação para o CRIADOR
        INSERT INTO notificacoes (
            profissional_id,
            tipo,
            titulo,
            mensagem,
            metadata,
            lida,
            created_at
        ) VALUES (
            v_criador_id,
            'meeting_presence',
            'Presença confirmada',
            format('%s confirmou presença na reunião "%s"', v_participante_nome, v_reuniao_titulo),
            jsonb_build_object(
                'reuniao_id', p_reuniao_id,
                'participante_id', p_participante_id
            ),
            FALSE,
            NOW()
        ) RETURNING id INTO v_notif_id;
        
        RETURN v_notif_id;
    END IF;
    
    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION notify_meeting_presence IS 'Notifica o criador da reunião quando um participante confirma presença';
