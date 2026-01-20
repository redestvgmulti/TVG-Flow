-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- TESTE VALIDAÇÃO: Migration 054 - Notification Context & Isolation
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 
-- Cole este script completo no Supabase SQL Editor e execute
-- 
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- STEP 1: Listar admins que receberão notificações
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SELECT 
    '📋 Admins Ativos (receberão notificação):' AS info;

SELECT 
    id,
    nome,
    role
FROM profissionais
WHERE role IN ('admin', 'manager', 'master')
  AND ativo = true
LIMIT 5;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- STEP 2: Criar item de teste na fila (ENTITY_TYPE CORRETO)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DO $$
DECLARE
    v_test_entity UUID := gen_random_uuid();
    v_queue_id UUID;
BEGIN
    INSERT INTO notification_queue (
        event_type,
        entity_id,
        entity_type,  -- ✅ Deve ser 'task' ou 'micro_task'
        payload,
        status
    )
    VALUES (
        'macro_completed',
        v_test_entity,
        'task',  -- ✅ CORRIGIDO (não 'macro_task')
        jsonb_build_object(
            'title', '[TESTE 054] Validação de Metadata',
            'message', 'Testando contexto rico e isolamento entre usuários',
            'link', '/admin/tasks/test-054'
        ),
        'pending'
    )
    RETURNING id INTO v_queue_id;
    
    RAISE NOTICE '✅ Queue item criado: %', v_queue_id;
    RAISE NOTICE '   Entity ID: %', v_test_entity;
END $$;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- STEP 3: Processar a fila
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SELECT '🔄 Processando fila...' AS info;

SELECT process_notification_queue();

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- STEP 4: Verificar notificações criadas (COM METADATA)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SELECT '✅ Notificações Criadas:' AS info;

SELECT 
    n.id,
    p.nome AS destinatario,
    p.role,
    n.type AS notification_type,
    n.title,
    n.message,
    n.metadata IS NOT NULL AS has_metadata,
    n.metadata->'event_type' AS meta_event_type,
    n.metadata->'entity_type' AS meta_entity_type,
    LEFT(n.metadata->>'profissional_target', 15) || '...' AS meta_target,
    LEFT(n.profissional_id::text, 15) || '...' AS profissional_id,
    (n.profissional_id::text = n.metadata->>'profissional_target') AS ownership_match,
    n.created_at
FROM notifications n
INNER JOIN profissionais p ON p.id = n.profissional_id
WHERE n.title = '[TESTE 054] Validação de Metadata'
ORDER BY p.nome;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- STEP 5: Verificar isolamento (cada admin tem sua própria notificação)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SELECT '🔒 Verificação de Isolamento:' AS info;

SELECT 
    p.nome,
    COUNT(*) AS notif_count,
    BOOL_AND(n.profissional_id::text = n.metadata->>'profissional_target') AS all_ownership_match,
    BOOL_AND(n.metadata IS NOT NULL) AS all_have_metadata
FROM notifications n
INNER JOIN profissionais p ON p.id = n.profissional_id
WHERE n.title = '[TESTE 054] Validação de Metadata'
GROUP BY p.nome, n.profissional_id
ORDER BY p.nome;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- STEP 6: Verificar estrutura completa do metadata
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SELECT '🔍 Chaves do Metadata:' AS info;

SELECT DISTINCT
    jsonb_object_keys(metadata) AS metadata_keys
FROM notifications
WHERE title = '[TESTE 054] Validação de Metadata'
ORDER BY metadata_keys;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- STEP 7: Exemplo de metadata completo
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SELECT '📦 Exemplo de Metadata Completo:' AS info;

SELECT 
    jsonb_pretty(metadata) AS metadata_json
FROM notifications
WHERE title = '[TESTE 054] Validação de Metadata'
LIMIT 1;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- STEP 8: CLEANUP (descomentar após validação)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- DELETE FROM notifications 
-- WHERE title = '[TESTE 054] Validação de Metadata';

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- RESULTADO ESPERADO:
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 
-- ✅ Cada admin deve ter UMA notificação
-- ✅ ownership_match = TRUE para todos
-- ✅ all_have_metadata = TRUE
-- ✅ metadata deve conter:
--    - event_type: "macro_completed"
--    - entity_id: UUID da tarefa
--    - entity_type: "task"
--    - payload: {title, message, link}
--    - profissional_target: UUID do admin
--    - queued_at: timestamp
-- 
-- Se todos os checks passarem: FIX 054 CONFIRMADO! ✅
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
