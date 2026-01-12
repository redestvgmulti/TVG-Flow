-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- VALIDAÇÃO COMPLETA EM PRODUÇÃO - SLA POR MICRO TAREFA
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- 1️⃣ VERIFICAR SCHEMA
SELECT column_name, is_nullable, data_type 
FROM information_schema.columns 
WHERE table_name = 'tarefas_itens' 
AND column_name IN ('deadline_at', 'started_at', 'finished_at');
-- Esperado: 3 linhas, todas com is_nullable = YES

-- 2️⃣ VERIFICAR INTEGRIDADE (CRÍTICO)
SELECT COUNT(*) as total, 
       COUNT(deadline_at) as com_deadline
FROM tarefas_itens;
-- Esperado: com_deadline = 0 (nenhuma micro tarefa antiga foi modificada)

-- 3️⃣ VERIFICAR TRIGGERS
SELECT trigger_name, event_manipulation
FROM information_schema.triggers
WHERE event_object_table = 'tarefas_itens'
AND trigger_name LIKE '%micro_task%';
-- Esperado: 2 triggers (started_at, finished_at)

-- 4️⃣ TESTAR RPCs (pegar um ID real primeiro)
SELECT id FROM tarefas_itens LIMIT 1;
-- Executar com ID retornado:
-- SELECT * FROM calcular_sla_micro_tarefa('ID_AQUI');
-- SELECT * FROM identificar_gargalo((SELECT tarefa_id FROM tarefas_itens LIMIT 1));

-- 5️⃣ TESTAR VIEW
SELECT COUNT(*) FROM vw_micro_tarefas_sla;
-- Deve executar sem erro

-- 6️⃣ PERFORMANCE CHECK
EXPLAIN ANALYZE
SELECT * FROM vw_micro_tarefas_sla
WHERE tarefa_id = (SELECT tarefa_id FROM tarefas_itens LIMIT 1);
-- Execution time deve ser < 500ms
