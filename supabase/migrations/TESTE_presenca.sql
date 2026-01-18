-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- TESTE: NOTIFICAÇÃO DE PRESENÇA
-- Date: 2026-01-18
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

DO $$
DECLARE
    v_reuniao_id UUID;
    v_criador_id UUID;
    v_participante_id UUID;
    v_notif_id UUID;
    v_nome_participante TEXT;
BEGIN
    -- 1. Buscar uma reunião existente
    SELECT id, criada_por 
    INTO v_reuniao_id, v_criador_id
    FROM reunioes 
    WHERE status = 'agendada' 
    LIMIT 1;
    
    -- 2. Buscar um participante QUE NÃO SEJA O CRIADOR
    SELECT id, nome
    INTO v_participante_id, v_nome_participante
    FROM profissionais 
    WHERE id != v_criador_id 
    LIMIT 1;
    
    IF v_reuniao_id IS NOT NULL AND v_participante_id IS NOT NULL THEN
        RAISE NOTICE '🧪 TESTE PRESENÇA:';
        RAISE NOTICE '   Reunião ID: %', v_reuniao_id;
        RAISE NOTICE '   Criador ID: %', v_criador_id;
        RAISE NOTICE '   Participante: % (%)', v_nome_participante, v_participante_id;
        
        -- 3. Chamar a RPC manualmente
        SELECT notify_meeting_presence(
            v_reuniao_id,
            v_participante_id
        ) INTO v_notif_id;
        
        IF v_notif_id IS NOT NULL THEN
            RAISE NOTICE '✅ SUCESSO! Notificação criada ID: %', v_notif_id;
        ELSE
            RAISE NOTICE '❌ FALHA: RPC retornou NULL';
        END IF;
    ELSE
        RAISE NOTICE '⚠️  Não foi possível encontrar dados de teste adequados.';
    END IF;
END $$;

-- 4. Verificar a notificação criada
SELECT 
    n.id,
    n.tipo, 
    n.titulo,
    n.mensagem, 
    p.nome as notificado_para,
    n.created_at
FROM notificacoes n
JOIN profissionais p ON p.id = n.profissional_id
WHERE n.tipo = 'meeting_presence'
ORDER BY n.created_at DESC
LIMIT 1;
