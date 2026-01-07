-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- Migration 1010: RLS Policies para comentários e eventos
-- Data: 2026-01-07
-- Descrição: Atualizar policies de task_comments e criar policies de os_eventos
--            usando função is_os_participant() para DRY e segurança
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

BEGIN;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 1. ATUALIZAR POLICIES: task_comments
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Drop policies antigas
DROP POLICY IF EXISTS "Professionals view comments on accessible tasks" ON task_comments;
DROP POLICY IF EXISTS "Professionals insert comments on accessible tasks" ON task_comments;
DROP POLICY IF EXISTS "Admins manage all comments" ON task_comments;
DROP POLICY IF EXISTS "Service role manages all comments" ON task_comments;

-- SELECT: Participantes veem comentários não deletados
CREATE POLICY "Ver comentários da OS"
ON task_comments FOR SELECT
TO authenticated
USING (
    deleted_at IS NULL
    AND is_os_participant(task_id)
);

-- INSERT: Participantes criam comentários
CREATE POLICY "Criar comentário na OS"
ON task_comments FOR INSERT
TO authenticated
WITH CHECK (
    author_id = auth.uid()
    AND is_os_participant(task_id)
);

-- UPDATE: Autor edita nos primeiros 15min OU admin sempre
CREATE POLICY "Editar próprio comentário"
ON task_comments FOR UPDATE
TO authenticated
USING (
    deleted_at IS NULL
    AND (
        (
            author_id = auth.uid()
            AND created_at > NOW() - INTERVAL '15 minutes'
        )
        OR is_admin_safe()
    )
)
WITH CHECK (
    -- Não pode mudar autor ou task_id
    author_id = (SELECT author_id FROM task_comments WHERE id = task_comments.id)
    AND task_id = (SELECT task_id FROM task_comments WHERE id = task_comments.id)
);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 2. CRIAR POLICIES: os_eventos
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- SELECT: Participantes veem eventos
CREATE POLICY "Ver eventos da OS"
ON os_eventos FOR SELECT
TO authenticated
USING (is_os_participant(os_id));

-- INSERT: Participantes ou sistema criam eventos
CREATE POLICY "Criar evento na OS"
ON os_eventos FOR INSERT
TO authenticated
WITH CHECK (
    (autor_id IS NULL OR autor_id = auth.uid())
    AND is_os_participant(os_id)
);

-- UPDATE/DELETE: Não há policies = eventos são IMUTÁVEIS

-- Comentários
COMMENT ON POLICY "Ver comentários da OS" ON task_comments IS 'ETAPA 3: Participantes veem comentários não deletados da OS';
COMMENT ON POLICY "Criar comentário na OS" ON task_comments IS 'ETAPA 3: Participantes criam comentários em OSs que participam';
COMMENT ON POLICY "Editar próprio comentário" ON task_comments IS 'ETAPA 3: Autor edita nos primeiros 15min OU admin sempre';
COMMENT ON POLICY "Ver eventos da OS" ON os_eventos IS 'ETAPA 3: Participantes veem eventos da OS';
COMMENT ON POLICY "Criar evento na OS" ON os_eventos IS 'ETAPA 3: Participantes criam eventos (autor_id validado)';

-- Log
DO $$
BEGIN
    RAISE NOTICE '✅ Migration 1010: RLS policies atualizadas para task_comments e os_eventos';
END $$;

COMMIT;
