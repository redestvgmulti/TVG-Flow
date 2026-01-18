-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- DIAGNÓSTICO: NOTIFICAÇÕES DE REUNIÕES
-- Data: 2026-01-18
-- Problema: Notificações não estão chegando
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 1️⃣ VERIFICAR SE TABELA DE NOTIFICAÇÕES EXISTE
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

SELECT 
    table_name,
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns
WHERE table_name = 'notificacoes'
ORDER BY ordinal_position;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 2️⃣ VERIFICAR SE RPC create_meeting_notification EXISTE
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

SELECT 
    proname as function_name,
    pg_get_function_arguments(oid) as arguments,
    pg_get_functiondef(oid) as definition
FROM pg_proc
WHERE proname = 'create_meeting_notification';

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 3️⃣ VERIFICAR REUNIÕES RECENTES (últimas 24h)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

SELECT 
    r.id,
    r.titulo,
    r.status,
    r.created_at,
    r.empresa_id,
    r.criada_por,
    COUNT(rp.id) as total_participantes
FROM reunioes r
LEFT JOIN reunioes_participantes rp ON rp.reuniao_id = r.id
WHERE r.created_at > NOW() - INTERVAL '24 hours'
GROUP BY r.id, r.titulo, r.status, r.created_at, r.empresa_id, r.criada_por
ORDER BY r.created_at DESC;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 4️⃣ VERIFICAR NOTIFICAÇÕES DE REUNIÕES (últimas 24h)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

SELECT 
    n.id,
    n.tipo,
    n.mensagem,
    n.profissional_id,
    n.created_at,
    n.lida,
    n.metadata
FROM notificacoes n
WHERE n.tipo LIKE 'meeting_%'
AND n.created_at > NOW() - INTERVAL '24 hours'
ORDER BY n.created_at DESC
LIMIT 20;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 5️⃣ TESTAR RPC create_meeting_notification MANUALMENTE
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Pegar uma reunião existente para teste
DO $$
DECLARE
    v_reuniao_id UUID;
    v_profissional_id UUID;
    v_titulo TEXT;
    v_data_inicio TIMESTAMPTZ;
    v_result UUID;
BEGIN
    -- Buscar uma reunião recente
    SELECT id, titulo, data_inicio 
    INTO v_reuniao_id, v_titulo, v_data_inicio
    FROM reunioes 
    ORDER BY created_at DESC 
    LIMIT 1;
    
    -- Buscar um profissional
    SELECT id INTO v_profissional_id
    FROM profissionais
    LIMIT 1;
    
    -- Testar a RPC
    IF v_reuniao_id IS NOT NULL AND v_profissional_id IS NOT NULL THEN
        RAISE NOTICE 'Testando RPC com:';
        RAISE NOTICE '  reuniao_id: %', v_reuniao_id;
        RAISE NOTICE '  profissional_id: %', v_profissional_id;
        RAISE NOTICE '  titulo: %', v_titulo;
        
        -- Testar criação de notificação de teste
        SELECT create_meeting_notification(
            v_reuniao_id,
            v_profissional_id,
            v_titulo || ' [TESTE]',
            v_data_inicio,
            0  -- Interval 0 = convite
        ) INTO v_result;
        
        RAISE NOTICE 'RPC retornou: %', v_result;
        
        IF v_result IS NULL THEN
            RAISE NOTICE 'ATENÇÃO: RPC retornou NULL (pode ser duplicata ou erro silencioso)';
        ELSE
            RAISE NOTICE 'SUCESSO: Notificação criada com ID %', v_result;
        END IF;
    ELSE
        RAISE NOTICE 'ERRO: Não foi possível encontrar reunião ou profissional para teste';
    END IF;
END $$;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 6️⃣ VERIFICAR RLS EM NOTIFICAÇÕES
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

SELECT 
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual,
    with_check
FROM pg_policies
WHERE tablename = 'notificacoes'
ORDER BY policyname;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 7️⃣ VERIFICAR SE CAMPO metadata EXISTE
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'notificacoes' 
AND column_name = 'metadata';

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 8️⃣ CONTAR NOTIFICAÇÕES POR TIPO
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

SELECT 
    tipo,
    COUNT(*) as total,
    COUNT(CASE WHEN lida = true THEN 1 END) as lidas,
    COUNT(CASE WHEN lida = false THEN 1 END) as nao_lidas,
    MAX(created_at) as ultima_notificacao
FROM notificacoes
GROUP BY tipo
ORDER BY MAX(created_at) DESC;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 9️⃣ VERIFICAR CONSTRAINT tem_referencia
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

SELECT 
    conname as constraint_name,
    contype as constraint_type,
    pg_get_constraintdef(oid) as constraint_definition
FROM pg_constraint
WHERE conrelid = 'notificacoes'::regclass;
