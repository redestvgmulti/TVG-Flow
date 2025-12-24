-- ============================================
-- AUDITORIA COMPLETA DO BANCO DE DADOS
-- Execute no Supabase SQL Editor
-- ============================================

-- 1️⃣ VERIFICAR SCHEMA DA TABELA TAREFAS
SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_name = 'tarefas'
ORDER BY ordinal_position;

-- 2️⃣ VERIFICAR SE COLUNA PRIORIDADE EXISTE
SELECT EXISTS (
    SELECT 1 
    FROM information_schema.columns 
    WHERE table_name = 'tarefas' 
    AND column_name = 'prioridade'
) as prioridade_exists;

-- 3️⃣ VERIFICAR VIEW TAREFAS_COM_STATUS_REAL
SELECT EXISTS (
    SELECT 1 
    FROM information_schema.views 
    WHERE table_name = 'tarefas_com_status_real'
) as view_exists;

-- 4️⃣ VERIFICAR TABELA OVERDUE_NOTIFICATIONS_LOG
SELECT EXISTS (
    SELECT 1 
    FROM information_schema.tables 
    WHERE table_name = 'overdue_notifications_log'
) as log_table_exists;

-- 5️⃣ VERIFICAR INTEGRIDADE REFERENCIAL
-- Tarefas órfãs (sem empresa válida)
SELECT COUNT(*) as tarefas_orfas
FROM tarefas t
WHERE NOT EXISTS (
    SELECT 1 FROM clientes c WHERE c.id = t.cliente_id
);

-- Microtarefas órfãs (sem tarefa macro)
SELECT COUNT(*) as microtarefas_orfas
FROM tarefas_itens ti
WHERE NOT EXISTS (
    SELECT 1 FROM tarefas t WHERE t.id = ti.tarefa_id
);

-- 6️⃣ VERIFICAR RLS POLICIES
SELECT 
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual
FROM pg_policies
WHERE tablename IN ('tarefas', 'tarefas_itens', 'empresa_profissionais')
ORDER BY tablename, policyname;

-- 7️⃣ VERIFICAR TRIGGERS
SELECT 
    trigger_name,
    event_manipulation,
    event_object_table,
    action_statement
FROM information_schema.triggers
WHERE event_object_table IN ('tarefas', 'tarefas_itens')
ORDER BY event_object_table, trigger_name;

-- 8️⃣ TESTAR CÁLCULO DE IS_OVERDUE
SELECT 
    id,
    titulo,
    deadline,
    status,
    NOW() > deadline AND status <> 'concluida' as is_overdue_calculated
FROM tarefas
LIMIT 5;

-- 9️⃣ VERIFICAR DADOS INCONSISTENTES
-- Tarefas com status completed mas microtarefas pendentes
SELECT 
    t.id,
    t.titulo,
    t.status as tarefa_status,
    COUNT(ti.id) as total_microtarefas,
    COUNT(ti.id) FILTER (WHERE ti.status = 'concluida') as microtarefas_concluidas
FROM tarefas t
LEFT JOIN tarefas_itens ti ON ti.tarefa_id = t.id
WHERE t.status = 'completed'
GROUP BY t.id, t.titulo, t.status
HAVING COUNT(ti.id) FILTER (WHERE ti.status = 'concluida') < COUNT(ti.id);

-- 🔟 VERIFICAR CONSTRAINTS
SELECT
    tc.constraint_name,
    tc.table_name,
    kcu.column_name,
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
    ON tc.constraint_name = kcu.constraint_name
LEFT JOIN information_schema.constraint_column_usage AS ccu
    ON ccu.constraint_name = tc.constraint_name
WHERE tc.table_name IN ('tarefas', 'tarefas_itens')
    AND tc.constraint_type IN ('FOREIGN KEY', 'CHECK', 'UNIQUE')
ORDER BY tc.table_name, tc.constraint_type;
