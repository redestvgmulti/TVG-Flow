-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- Migration 1016: Criar VIEW os_timeline_view
-- Data: 2026-01-07
-- Descrição: VIEW unificada que combina comentários (task_comments) e
--            eventos (os_eventos) em uma única timeline ordenada
--            cronologicamente. Aplica RLS inline para blindagem multi-tenant.
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

BEGIN;

-- Criar VIEW unificada de timeline
CREATE OR REPLACE VIEW os_timeline_view
WITH (security_invoker = true) -- Força aplicação de RLS
AS
-- COMENTÁRIOS
SELECT
    'comentario' AS item_tipo,
    c.id,
    c.task_id AS os_id,
    c.content AS texto,
    NULL::os_evento_tipo AS evento_tipo,
    NULL::JSONB AS metadata,
    c.author_id AS autor_id,
    p.nome AS autor_nome,
    c.editado,
    c.created_at,
    c.updated_at,
    
    -- ✅ BLINDAGEM MULTI-TENANT: Validar empresa_id
    (SELECT empresa_id FROM tarefas WHERE id = c.task_id) AS empresa_id
    
FROM task_comments c
LEFT JOIN profissionais p ON p.id = c.author_id
WHERE c.deleted_at IS NULL -- Apenas comentários não deletados
  AND is_os_participant(c.task_id) -- ✅ RLS inline

UNION ALL

-- EVENTOS
SELECT
    'evento' AS item_tipo,
    e.id,
    e.os_id,
    NULL AS texto,
    e.tipo AS evento_tipo,
    e.metadata,
    e.autor_id,
    p.nome AS autor_nome,
    NULL AS editado,
    e.created_at,
    NULL AS updated_at,
    
    -- ✅ BLINDAGEM MULTI-TENANT: Validar empresa_id
    (SELECT empresa_id FROM tarefas WHERE id = e.os_id) AS empresa_id
    
FROM os_eventos e
LEFT JOIN profissionais p ON p.id = e.autor_id
WHERE is_os_participant(e.os_id); -- ✅ RLS inline

-- Comentários
COMMENT ON VIEW os_timeline_view IS 'ETAPA 3: Timeline unificada de comentários e eventos. Aplica RLS via is_os_participant() inline. security_invoker = true força verificação de permissões.';

-- Log
DO $$
BEGIN
    RAISE NOTICE '✅ Migration 1016: VIEW os_timeline_view criada (comentários + eventos)';
END $$;

COMMIT;
