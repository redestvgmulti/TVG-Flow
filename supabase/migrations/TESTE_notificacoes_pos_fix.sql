-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- TESTE: VALIDAÇÃO COMPLETA DE NOTIFICAÇÕES
-- Date: 2026-01-18
-- Status: VALIDATION AFTER HOTFIX
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- TESTE 1: Criar notificação de convite manualmente
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

DO $$
DECLARE
    v_reuniao_id UUID;
    v_profissional_id UUID;
    v_titulo TEXT;
    v_data_inicio TIMESTAMPTZ;
    v_result UUID;
BEGIN
    -- Buscar reunião mais recente
    SELECT id, titulo, data_inicio 
    INTO v_reuniao_id, v_titulo, v_data_inicio
    FROM reunioes 
    WHERE status = 'agendada'
    ORDER BY created_at DESC 
    LIMIT 1;
    
    -- Buscar profissional
    SELECT id INTO v_profissional_id
    FROM profissionais
    LIMIT 1;
    
    IF v_reuniao_id IS NOT NULL AND v_profissional_id IS NOT NULL THEN
        RAISE NOTICE '🧪 TESTE 1: Criando notificação de convite...';
        RAISE NOTICE '   Reunião: % (%)', v_titulo, v_reuniao_id;
        RAISE NOTICE '   Profissional: %', v_profissional_id;
        
        -- Chamar RPC
        SELECT create_meeting_notification(
            v_reuniao_id,
            v_profissional_id,
            v_titulo,
            v_data_inicio,
            0  -- Convite (interval 0)
        ) INTO v_result;
        
        IF v_result IS NOT NULL THEN
            RAISE NOTICE '✅ Notificação criada com ID: %', v_result;
        ELSE
            RAISE NOTICE '⚠️  RPC retornou NULL (pode ser duplicata)';
        END IF;
    ELSE
        RAISE NOTICE '❌ Sem dados para teste';
    END IF;
END $$;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- TESTE 2: Listar notificações recém-criadas
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

SELECT 
    n.id,
    n.tipo,
    n.titulo,          -- ✅ Agora deve estar preenchido
    n.mensagem,
    n.profissional_id,
    p.nome as profissional_nome,
    n.metadata->>'reuniao_id' as reuniao_id,
    n.metadata->>'interval_minutes' as interval,
    n.lida,
    n.created_at
FROM notificacoes n
LEFT JOIN profissionais p ON p.id = n.profissional_id
WHERE n.tipo LIKE 'meeting_%'
AND n.created_at > NOW() - INTERVAL '5 minutes'
ORDER BY n.created_at DESC
LIMIT 10;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- TESTE 3: Criar reunião completa e verificar notificações
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

DO $$
DECLARE
    v_empresa_id UUID;
    v_criador_id UUID;
    v_reuniao_id UUID;
    v_participante1_id UUID;
    v_participante2_id UUID;
    v_notif1 UUID;
    v_notif2 UUID;
BEGIN
    -- Buscar IDs
    SELECT id INTO v_empresa_id FROM empresas LIMIT 1;
    SELECT id INTO v_criador_id FROM profissionais WHERE role = 'admin' LIMIT 1;
    SELECT id INTO v_participante1_id FROM profissionais WHERE role = 'staff' LIMIT 1 OFFSET 0;
    SELECT id INTO v_participante2_id FROM profissionais WHERE role = 'staff' LIMIT 1 OFFSET 1;
    
    IF v_empresa_id IS NOT NULL AND v_criador_id IS NOT NULL THEN
        RAISE NOTICE '🧪 TESTE 3: Criando reunião completa...';
        
        -- Criar reunião
        INSERT INTO reunioes (
            empresa_id,
            titulo,
            descricao,
            data_inicio,
            data_fim,
            criada_por,
            status,
            timezone
        ) VALUES (
            v_empresa_id,
            'TESTE VALIDAÇÃO - Notificações',
            'Teste pós-hotfix de notificações',
            NOW() + INTERVAL '2 hours',
            NOW() + INTERVAL '3 hours',
            v_criador_id,
            'agendada',
            'America/Sao_Paulo'
        ) RETURNING id INTO v_reuniao_id;
        
        RAISE NOTICE '✅ Reunião criada: %', v_reuniao_id;
        
        -- Adicionar participantes
        IF v_participante1_id IS NOT NULL THEN
            INSERT INTO reunioes_participantes (reuniao_id, profissional_id, confirmado)
            VALUES (v_reuniao_id, v_participante1_id, false);
            RAISE NOTICE '✅ Participante 1 adicionado: %', v_participante1_id;
        END IF;
        
        IF v_participante2_id IS NOT NULL THEN
            INSERT INTO reunioes_participantes (reuniao_id, profissional_id, confirmado)
            VALUES (v_reuniao_id, v_participante2_id, false);
            RAISE NOTICE '✅ Participante 2 adicionado: %', v_participante2_id;
        END IF;
        
        -- Criar notificações via RPC (simulando o que o frontend faz)
        IF v_participante1_id IS NOT NULL THEN
            SELECT create_meeting_notification(
                v_reuniao_id,
                v_participante1_id,
                'TESTE VALIDAÇÃO - Notificações',
                NOW() + INTERVAL '2 hours',
                0
            ) INTO v_notif1;
            
            IF v_notif1 IS NOT NULL THEN
                RAISE NOTICE '✅ Notificação 1 criada: %', v_notif1;
            ELSE
                RAISE NOTICE '⚠️  Notificação 1 não foi criada (NULL)';
            END IF;
        END IF;
        
        IF v_participante2_id IS NOT NULL THEN
            SELECT create_meeting_notification(
                v_reuniao_id,
                v_participante2_id,
                'TESTE VALIDAÇÃO - Notificações',
                NOW() + INTERVAL '2 hours',
                0
            ) INTO v_notif2;
            
            IF v_notif2 IS NOT NULL THEN
                RAISE NOTICE '✅ Notificação 2 criada: %', v_notif2;
            ELSE
                RAISE NOTICE '⚠️  Notificação 2 não foi criada (NULL)';
            END IF;
        END IF;
        
        RAISE NOTICE '';
        RAISE NOTICE '📊 RESUMO DO TESTE:';
        RAISE NOTICE '   Reunião ID: %', v_reuniao_id;
        RAISE NOTICE '   Notificação 1: %', COALESCE(v_notif1::TEXT, 'NULL');
        RAISE NOTICE '   Notificação 2: %', COALESCE(v_notif2::TEXT, 'NULL');
    ELSE
        RAISE NOTICE '❌ Sem dados para teste completo';
    END IF;
END $$;

-- Listar notificações da reunião de teste
SELECT 
    n.id,
    n.tipo,
    n.titulo,
    n.mensagem,
    p.nome as profissional,
    n.created_at
FROM notificacoes n
JOIN profissionais p ON p.id = n.profissional_id
WHERE n.metadata->>'titulo' LIKE '%TESTE VALIDAÇÃO%'
ORDER BY n.created_at DESC;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- TESTE 4: Verificar todos os tipos de notificação
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

SELECT 
    tipo,
    COUNT(*) as total,
    COUNT(CASE WHEN titulo IS NOT NULL THEN 1 END) as com_titulo,
    COUNT(CASE WHEN titulo IS NULL THEN 1 END) as sem_titulo,
    MAX(created_at) as ultima
FROM notificacoes
WHERE tipo LIKE 'meeting_%'
GROUP BY tipo
ORDER BY MAX(created_at) DESC;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- CLEANUP (OPCIONAL): Remover reunião e notificações de teste
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Descomente se quiser limpar os dados de teste:

-- DELETE FROM notificacoes 
-- WHERE metadata->>'titulo' LIKE '%TESTE VALIDAÇÃO%';

-- DELETE FROM reunioes_participantes
-- WHERE reuniao_id IN (
--     SELECT id FROM reunioes WHERE titulo LIKE '%TESTE VALIDAÇÃO%'
-- );

-- DELETE FROM reunioes 
-- WHERE titulo LIKE '%TESTE VALIDAÇÃO%';
