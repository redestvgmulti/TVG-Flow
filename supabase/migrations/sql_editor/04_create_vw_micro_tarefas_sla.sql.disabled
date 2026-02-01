-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- View: Micro Tarefas com SLA (apenas micro tarefas que possuem deadline)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE OR REPLACE VIEW vw_micro_tarefas_sla AS
SELECT 
    ti.id,
    ti.tarefa_id,
    ti.profissional_id,
    p.nome as profissional_nome,
    ti.status,
    ti.deadline_at,
    ti.started_at,
    ti.finished_at,
    ti.created_at,
    ti.observacoes,
    ti.entrega_link,
    
    -- 🔒 Cálculo dinâmico de atraso (só se deadline_at existir)
    CASE 
        WHEN ti.deadline_at IS NULL THEN FALSE
        ELSE (now() > ti.deadline_at AND ti.status != 'concluida')
    END as atrasada,
    
    -- Tempo de atraso em minutos
    CASE 
        WHEN ti.deadline_at IS NOT NULL 
             AND now() > ti.deadline_at 
             AND ti.status != 'concluida'
        THEN EXTRACT(EPOCH FROM (now() - ti.deadline_at)) / 60
        ELSE 0
    END as tempo_atraso_minutos,
    
    -- Tempo em execução
    CASE 
        WHEN ti.started_at IS NOT NULL AND ti.status != 'concluida'
        THEN EXTRACT(EPOCH FROM (now() - ti.started_at)) / 60
        ELSE NULL
    END as tempo_execucao_minutos,
    
    -- Tempo total de conclusão
    CASE 
        WHEN ti.finished_at IS NOT NULL AND ti.started_at IS NOT NULL
        THEN EXTRACT(EPOCH FROM (ti.finished_at - ti.started_at)) / 60
        ELSE NULL
    END as tempo_total_conclusao_minutos,
    
    -- Status visual de SLA
    CASE 
        WHEN ti.deadline_at IS NULL THEN 'sem_sla'
        WHEN ti.status = 'concluida' THEN 'concluida'
        WHEN now() > ti.deadline_at THEN 'atrasada'
        WHEN now() > (ti.deadline_at - INTERVAL '4 hours') THEN 'proximo_prazo'
        ELSE 'no_prazo'
    END as status_sla
    
FROM tarefas_itens ti
JOIN profissionais p ON p.id = ti.profissional_id;

-- 🔒 Índice para otimizar queries por tarefa_id (sempre usado com WHERE tarefa_id)
CREATE INDEX IF NOT EXISTS idx_tarefas_itens_tarefa_id
ON tarefas_itens(tarefa_id);

COMMENT ON VIEW vw_micro_tarefas_sla IS 
  'View otimizada para SLA. Micro tarefas com deadline_at=NULL retornam status_sla=sem_sla';
