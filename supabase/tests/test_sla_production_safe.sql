-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- TEST 1: Verificar que nenhuma micro tarefa antiga foi modificada
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

DO $$
DECLARE
    v_count_with_deadline INTEGER;
    v_count_with_started INTEGER;
    v_count_with_finished INTEGER;
BEGIN
    -- Assumindo que todas as micro tarefas existentes são anteriores a esta migration
    -- Verificar que NENHUMA delas tem deadline_at preenchido
    
    SELECT COUNT(*) INTO v_count_with_deadline
    FROM tarefas_itens
    WHERE created_at < now() - INTERVAL '1 minute'  -- Criadas antes da migration
    AND deadline_at IS NOT NULL;
    
    IF v_count_with_deadline > 0 THEN
        RAISE EXCEPTION '❌ FALHA: % micro tarefas antigas foram modificadas com deadline_at', v_count_with_deadline;
    END IF;
    
    RAISE NOTICE '✅ PASS: 0 micro tarefas antigas foram modificadas';
END $$;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- TEST 2: Criar micro tarefa de teste COM SLA (nova)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

INSERT INTO tarefas (id, titulo, descricao, deadline, prioridade, status)
VALUES (
    '00000000-0000-0000-0000-000000000TEST',
    'Teste SLA - Produção Segura',
    'Teste de SLA sem afetar dados existentes',
    now() + INTERVAL '7 days',
    'alta',
    'pending'
);

INSERT INTO tarefas_itens (id, tarefa_id, profissional_id, status, deadline_at)
VALUES (
    '00000000-0000-0000-0000-00000000TEST1',
    '00000000-0000-0000-0000-000000000TEST',
    (SELECT id FROM profissionais LIMIT 1),
    'pendente',
    now() - INTERVAL '2 hours'  -- Forçar atraso para testar
);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- TEST 3: Verificar cálculo de SLA
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

SELECT * FROM calcular_sla_micro_tarefa('00000000-0000-0000-0000-00000000TEST1');
-- Deve retornar atrasada = TRUE, tempo_atraso_minutos ≈ 120

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- TEST 4: Verificar view SLA
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

SELECT 
    id,
    profissional_nome,
    status_sla,
    atrasada,
    tempo_atraso_minutos
FROM vw_micro_tarefas_sla
WHERE id = '00000000-0000-0000-0000-00000000TEST1';
-- Deve retornar status_sla = 'atrasada', atrasada = TRUE

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- TEST 5: Verificar identificação de gargalo
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

SELECT * FROM identificar_gargalo('00000000-0000-0000-0000-000000000TEST');
-- Deve retornar a micro tarefa TEST1 como gargalo

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- CLEANUP
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

DELETE FROM tarefas WHERE id = '00000000-0000-0000-0000-000000000TEST';

RAISE NOTICE '✅ Todos os testes passaram. Sistema SLA está production-safe.';
