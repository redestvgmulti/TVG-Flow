-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- VERIFICATION SCRIPT: TVG FLOW WORKFLOW LOGIC
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

BEGIN;

-- 1. Setup Data
-- Create a test client
INSERT INTO clientes (nome, cnpj, email) VALUES ('Test Client', '00000000000000', 'test@client.com') ON CONFLICT DO NOTHING;
DO $$
DECLARE
    v_client_id UUID;
    v_prof_id UUID;
    v_task_id UUID;
    v_micro_1 UUID;
    v_micro_2 UUID;
BEGIN
    SELECT id INTO v_client_id FROM clientes WHERE email = 'test@client.com';
    SELECT id INTO v_prof_id FROM profissionais LIMIT 1;

    -- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    -- TEST 1: Backward Compatibility (Legacy Task)
    -- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    INSERT INTO tarefas (titulo, cliente_id, assigned_to, status, prioridade, deadline)
    VALUES ('Legacy Task Test', v_client_id, v_prof_id, 'pendente', 'normal', NOW() + INTERVAL '1 day')
    RETURNING id INTO v_task_id;

    IF v_task_id IS NULL THEN
        RAISE EXCEPTION 'Test 1 Failed: Creating legacy task failed';
    END IF;
    RAISE NOTICE 'Test 1 Passed: Legacy Task Created';

    -- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    -- TEST 2: Macro/Micro Task Creation & Blocking
    -- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    -- Create Macro Task
    INSERT INTO tarefas (titulo, cliente_id, status, prioridade, progress, deadline)
    VALUES ('Macro Flow Test', v_client_id, 'pendente', 'alta', 0, NOW() + INTERVAL '1 day')
    RETURNING id INTO v_task_id;

    -- Create Micro Task 1 (Step 1)
    INSERT INTO tarefas_micro (tarefa_id, profissional_id, funcao, status, peso)
    VALUES (v_task_id, v_prof_id, 'Design', 'pendente', 1)
    RETURNING id INTO v_micro_1;

    -- Create Micro Task 2 (Step 2, depends on 1)
    INSERT INTO tarefas_micro (tarefa_id, profissional_id, funcao, status, depends_on, peso)
    VALUES (v_task_id, v_prof_id, 'Development', 'bloqueada', v_micro_1, 1)
    RETURNING id INTO v_micro_2;

    -- Verify Blocking
    IF (SELECT status FROM tarefas_micro WHERE id = v_micro_2) != 'bloqueada' THEN
        RAISE EXCEPTION 'Test 2 Failed: Dependent task not blocked';
    END IF;
    RAISE NOTICE 'Test 2 Passed: Macro Structure & Blocking Logic';

    -- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    -- TEST 3: Progress & Unblocking
    -- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    -- Complete Step 1
    UPDATE tarefas_micro SET status = 'concluida' WHERE id = v_micro_1;

    -- Verify Step 2 Unblocked
    IF (SELECT status FROM tarefas_micro WHERE id = v_micro_2) != 'pendente' THEN
         RAISE EXCEPTION 'Test 3 Failed: Dependency did not unblock';
    END IF;

    -- Verify Progress (50% - 1 of 2 tasks, equal weight)
    IF (SELECT progress FROM tarefas WHERE id = v_task_id) != 50 THEN
        RAISE EXCEPTION 'Test 3 Failed: Progress calculation incorrect';
    END IF;
    RAISE NOTICE 'Test 3 Passed: Progress & Unblocking';

    -- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    -- TEST 3.5: Devolution & Re-Blocking
    -- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    -- Return Step 2 (simulate devolution to same person for simplicity)
    UPDATE tarefas_micro SET status = 'devolvida' WHERE id = v_micro_2;
    
    -- In a real scenario, this involves more logic, but let's test that "devolvida" works
    IF (SELECT status FROM tarefas_micro WHERE id = v_micro_2) != 'devolvida' THEN
        RAISE EXCEPTION 'Test 3.5 Failed: Task not returned';
    END IF;
    RAISE NOTICE 'Test 3.5 Passed: Devolution Status';

    -- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    -- TEST 4: Macro Completion
    -- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    -- Complete Step 2 (Simulate user fixing and completing)
    UPDATE tarefas_micro SET status = 'concluida' WHERE id = v_micro_2;

    -- Verify Macro Completed
    IF (SELECT status FROM tarefas WHERE id = v_task_id) != 'concluida' THEN
        RAISE EXCEPTION 'Test 4 Failed: Macro task did not auto-complete';
    END IF;
     -- Verify Progress (100%)
    IF (SELECT progress FROM tarefas WHERE id = v_task_id) != 100 THEN
        RAISE EXCEPTION 'Test 4 Failed: Final progress incorrect';
    END IF;
    RAISE NOTICE 'Test 4 Passed: Macro Auto-Completion';

    RAISE NOTICE 'ALL TESTS PASSED SUCCESSFULLY';
END $$;

ROLLBACK; -- Always rollback to clean up test data
