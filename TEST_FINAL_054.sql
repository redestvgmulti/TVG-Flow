-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- TESTE COMPLETO: Migration 054 - Segunda Execução (Validação Final)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- 🧹 CLEANUP: Remover testes anteriores
DELETE FROM notifications WHERE title LIKE '[TESTE 054]%';

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- STEP 1: Listar todos os admins ativos
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SELECT '📋 STEP 1: Admins Ativos' AS info;

SELECT id, nome, role
FROM profissionais
WHERE role IN ('admin', 'manager', 'master')
  AND ativo = true;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- STEP 2: Criar item de teste na fila
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DO $$
DECLARE
    v_test_entity UUID := gen_random_uuid();
    v_queue_id UUID;
BEGIN
    INSERT INTO notification_queue (
        event_type,
        entity_id,
        entity_type,
        payload,
        status
    )
    VALUES (
        'macro_completed',
        v_test_entity,
        'task',
        jsonb_build_object(
            'title', '[TESTE 054] Segunda Validação',
            'message', 'Confirmando metadata e isolamento',
            'link', '/admin/tasks/final-test'
        ),
        'pending'
    )
    RETURNING id INTO v_queue_id;
    
    RAISE NOTICE '✅ Queue item criado: %', v_queue_id;
    RAISE NOTICE '   Entity ID: %', v_test_entity;
END $$;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- STEP 3: Processar fila
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SELECT '🔄 STEP 2: Processando fila...' AS info;

SELECT process_notification_queue();

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- STEP 4: Verificar notificações (RESUMO)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SELECT '✅ STEP 3: Notificações Criadas' AS info;

SELECT 
    p.nome AS destinatario,
    n.type,
    n.title,
    n.metadata IS NOT NULL AS has_metadata,
    n.profissional_id::text = n.metadata->>'profissional_target' AS ownership_match
FROM notifications n
INNER JOIN profissionais p ON p.id = n.profissional_id
WHERE n.title = '[TESTE 054] Segunda Validação'
ORDER BY p.nome;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- STEP 5: Verificar isolamento por usuário
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SELECT '🔒 STEP 4: Verificação de Isolamento' AS info;

SELECT 
    p.nome,
    COUNT(*) AS notificacoes,
    BOOL_AND(n.profissional_id::text = n.metadata->>'profissional_target') AS ownership_ok,
    BOOL_AND(n.metadata IS NOT NULL) AS metadata_ok
FROM notifications n
INNER JOIN profissionais p ON p.id = n.profissional_id
WHERE n.title = '[TESTE 054] Segunda Validação'
GROUP BY p.nome
ORDER BY p.nome;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- STEP 6: Verificar chaves do metadata
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SELECT '🔍 STEP 5: Estrutura do Metadata' AS info;

SELECT DISTINCT jsonb_object_keys(metadata) AS chave
FROM notifications
WHERE title = '[TESTE 054] Segunda Validação'
ORDER BY chave;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- STEP 7: Exemplo de metadata completo
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SELECT '📦 STEP 6: Metadata Completo (Exemplo)' AS info;

SELECT jsonb_pretty(metadata) AS metadata_json
FROM notifications
WHERE title = '[TESTE 054] Segunda Validação'
LIMIT 1;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- VEREDITO FINAL
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SELECT '🎯 VEREDITO ESPERADO:' AS info;
SELECT '✅ has_metadata = TRUE para todos' AS check1;
SELECT '✅ ownership_match = TRUE para todos' AS check2;
SELECT '✅ metadata_ok = TRUE para todos' AS check3;
SELECT '✅ Cada admin aparece UMA vez' AS check4;
SELECT '✅ Chaves: entity_id, entity_type, event_type, payload, profissional_target, queued_at' AS check5;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- CLEANUP FINAL (descomentar após validação)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- DELETE FROM notifications WHERE title LIKE '[TESTE 054]%';
