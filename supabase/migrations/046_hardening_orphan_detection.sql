-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- HARDENING 006: Orphaned Task Detection & Cleanup
-- Migration: 046_hardening_orphan_detection.sql
-- Priority: MEDIUM
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 
-- PROBLEMA:
-- Tarefa macro pode ser criada sem micro-tasks (falha transacional), ficando
-- órfã e sem possibilidade de progresso. Nenhuma detecção/alerta existe.
--
-- SOLUÇÃO:
-- - View para identificar tarefas órfãs recentes
-- - Função de cleanup automático (executável via cron ou manual)
-- - Constraint suave via CHECK (opcional)
--
-- IMPACTO:
-- Zero breaking changes. View é read-only, função é opt-in.
-- Cleanup só remove tarefas órfãs com mais de 24h (configurável).
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 1. CREATE DETECTION VIEW
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE OR REPLACE VIEW vw_tarefas_orfas AS
SELECT 
    t.id,
    t.titulo,
    t.empresa_id,
    t.created_by,
    t.created_at,
    t.deadline,
    t.progress,
    t.status,
    CURRENT_TIMESTAMP - t.created_at AS idade,
    -- Informações extras para debug
    (SELECT nome FROM profissionais WHERE id = t.created_by) AS criador_nome,
    (SELECT nome FROM clientes WHERE id = t.empresa_id) AS empresa_nome
FROM tarefas t
LEFT JOIN tarefas_micro tm ON tm.tarefa_id = t.id
WHERE tm.id IS NULL  -- Sem micro-tasks vinculadas
AND t.created_at > (CURRENT_TIMESTAMP - INTERVAL '30 days')  -- Últimos 30 dias
ORDER BY t.created_at DESC;

COMMENT ON VIEW vw_tarefas_orfas IS 
'Hardening: Detecta tarefas macro criadas sem micro-tasks (possível falha transacional).
Mostra tarefas órfãs dos últimos 30 dias para investigação e correção manual.';

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 2. CREATE CLEANUP FUNCTION
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE OR REPLACE FUNCTION cleanup_orphaned_tasks(
    p_min_age_hours INTEGER DEFAULT 24
) RETURNS TABLE (
    deleted_count INTEGER,
    deleted_ids UUID[]
) AS $$
DECLARE
    v_deleted_ids UUID[];
    v_count INTEGER;
BEGIN
    -- Validação: idade mínima deve ser >= 1 hora
    IF p_min_age_hours < 1 THEN
        RAISE EXCEPTION 'Idade mínima deve ser >= 1 hora (recebido: %)', p_min_age_hours;
    END IF;
    
    -- Deletar tarefas órfãs antigas
    WITH deleted AS (
        DELETE FROM tarefas
        WHERE id IN (
            SELECT t.id 
            FROM tarefas t
            LEFT JOIN tarefas_micro tm ON tm.tarefa_id = t.id
            WHERE tm.id IS NULL
            AND t.created_at < (CURRENT_TIMESTAMP - (p_min_age_hours || ' hours')::INTERVAL)
        )
        RETURNING id
    )
    SELECT 
        COUNT(*)::INTEGER,
        ARRAY_AGG(id)
    INTO v_count, v_deleted_ids
    FROM deleted;
    
    -- Retornar resultado
    deleted_count := COALESCE(v_count, 0);
    deleted_ids := COALESCE(v_deleted_ids, ARRAY[]::UUID[]);
    
    RETURN QUERY SELECT deleted_count, deleted_ids;
    
    -- Log da operação
    RAISE NOTICE 'Cleanup concluído: % tarefas órfãs removidas (idade mínima: %h)', 
        deleted_count, p_min_age_hours;
        
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION cleanup_orphaned_tasks TO authenticated;

COMMENT ON FUNCTION cleanup_orphaned_tasks IS 
'Hardening: Remove tarefas macro sem micro-tasks com idade >= p_min_age_hours.
Padrão: 24 horas. Retorna contagem e IDs deletados.

Uso:
SELECT * FROM cleanup_orphaned_tasks(); -- 24h padrão
SELECT * FROM cleanup_orphaned_tasks(48); -- 48h customizado';

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 3. CREATE ALERT FUNCTION (opcional)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE OR REPLACE FUNCTION check_orphaned_tasks_alert()
RETURNS TABLE (
    total_orfas INTEGER,
    mais_recente TIMESTAMPTZ,
    mais_antiga TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COUNT(*)::INTEGER AS total_orfas,
        MAX(created_at) AS mais_recente,
        MIN(created_at) AS mais_antiga
    FROM vw_tarefas_orfas;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION check_orphaned_tasks_alert TO authenticated;

COMMENT ON FUNCTION check_orphaned_tasks_alert IS 
'Hardening: Retorna estatísticas de tarefas órfãs para monitoramento.
Use em dashboards de saúde do sistema.';

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 4. CREATE SCHEDULED JOB (pg_cron - opcional)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Executar manualmente se pg_cron estiver disponível:
--
-- SELECT cron.schedule(
--     'cleanup-orphaned-tasks',
--     '0 3 * * *', -- Todo dia às 3AM UTC
--     $$ SELECT cleanup_orphaned_tasks(24); $$
-- );

-- Verificar jobs criados:
-- SELECT * FROM cron.job;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 5. SAMPLE QUERIES FOR MONITORING
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Listar todas as tarefas órfãs
-- SELECT * FROM vw_tarefas_orfas;

-- Estatísticas de órfãs
-- SELECT * FROM check_orphaned_tasks_alert();

-- Cleanup manual (teste)
-- SELECT * FROM cleanup_orphaned_tasks(48);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 6. ROLLBACK INSTRUCTIONS (if needed)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
--
-- DROP VIEW IF EXISTS vw_tarefas_orfas;
-- DROP FUNCTION IF EXISTS cleanup_orphaned_tasks;
-- DROP FUNCTION IF EXISTS check_orphaned_tasks_alert;
-- SELECT cron.unschedule('cleanup-orphaned-tasks'); -- Se criou cron job
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
