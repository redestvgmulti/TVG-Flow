-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- RPC: Calcular SLA de uma micro tarefa
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE OR REPLACE FUNCTION calcular_sla_micro_tarefa(p_micro_task_id UUID)
RETURNS TABLE (
    atrasada BOOLEAN,
    tempo_atraso_minutos INTEGER,
    status_sla TEXT
) AS $$
DECLARE
    v_micro_task RECORD;
BEGIN
    -- Buscar micro tarefa
    SELECT * INTO v_micro_task
    FROM tarefas_itens
    WHERE id = p_micro_task_id;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Micro tarefa não encontrada: %', p_micro_task_id;
    END IF;
    
    -- 🔒 Se não tem deadline_at, não tem SLA
    IF v_micro_task.deadline_at IS NULL THEN
        atrasada := FALSE;
        tempo_atraso_minutos := 0;
        status_sla := 'sem_sla';
        RETURN NEXT;
        RETURN;
    END IF;
    
    -- Calcular se está atrasada
    atrasada := (now() > v_micro_task.deadline_at AND v_micro_task.status != 'concluida');
    
    -- Calcular tempo de atraso em minutos
    IF atrasada THEN
        tempo_atraso_minutos := EXTRACT(EPOCH FROM (now() - v_micro_task.deadline_at)) / 60;
    ELSE
        tempo_atraso_minutos := 0;
    END IF;
    
    -- Determinar status SLA
    IF v_micro_task.status = 'concluida' THEN
        status_sla := 'concluida';
    ELSIF atrasada THEN
        status_sla := 'atrasada';
    ELSIF now() > (v_micro_task.deadline_at - INTERVAL '4 hours') THEN
        status_sla := 'proximo_prazo';
    ELSE
        status_sla := 'no_prazo';
    END IF;
    
    RETURN NEXT;
END;
$$ LANGUAGE plpgsql STABLE;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- RPC: Identificar gargalo de uma tarefa macro
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE OR REPLACE FUNCTION identificar_gargalo(p_tarefa_id UUID)
RETURNS TABLE (
    micro_task_id UUID,
    profissional_id UUID,
    profissional_nome TEXT,
    deadline_at TIMESTAMPTZ,
    tempo_atraso_minutos INTEGER,
    mensagem TEXT
) AS $$
BEGIN
    RETURN QUERY
    WITH micro_tasks_com_sla AS (
        -- 🔒 Apenas micro tarefas com SLA ativo (deadline_at IS NOT NULL)
        SELECT 
            ti.id,
            ti.profissional_id,
            p.nome as prof_nome,
            ti.status,
            ti.deadline_at,
            ti.created_at,
            EXTRACT(EPOCH FROM (now() - ti.deadline_at)) / 60 AS atraso_minutos
        FROM tarefas_itens ti
        JOIN profissionais p ON p.id = ti.profissional_id
        WHERE ti.tarefa_id = p_tarefa_id
        AND ti.deadline_at IS NOT NULL  -- 🔒 CRITICAL: Só micro tarefas com SLA
        AND ti.status != 'concluida'
        AND now() > ti.deadline_at
        ORDER BY ti.created_at ASC  -- Primeira etapa tem prioridade
        LIMIT 1  -- Apenas o gargalo principal
    )
    SELECT 
        mts.id,
        mts.profissional_id,
        mts.prof_nome,
        mts.deadline_at,
        mts.atraso_minutos::INTEGER,
        'Esta etapa está atrasando o fluxo e bloqueando as próximas etapas'::TEXT
    FROM micro_tasks_com_sla mts;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION calcular_sla_micro_tarefa(UUID) IS 
  'Calcula SLA de uma micro tarefa. Retorna sem_sla se deadline_at IS NULL (micro tarefas antigas).';
COMMENT ON FUNCTION identificar_gargalo(UUID) IS 
  'Identifica primeira micro tarefa atrasada que está travando o fluxo. Ignora micro tarefas sem deadline_at.';
