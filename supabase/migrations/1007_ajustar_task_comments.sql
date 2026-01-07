-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- Migration 1007: Ajustar task_comments para ETAPA 3
-- Data: 2026-01-07
-- Descrição: Adicionar campos necessários para funcionalidades de edição,
--            soft delete e auditoria em comentários
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

BEGIN;

-- Adicionar colunas faltantes
ALTER TABLE task_comments
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW(),
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS editado BOOLEAN DEFAULT false;

-- Constraint de limite de caracteres (5000)
ALTER TABLE task_comments
DROP CONSTRAINT IF EXISTS content_length_limit;

ALTER TABLE task_comments
ADD CONSTRAINT content_length_limit CHECK (char_length(content) > 0 AND char_length(content) <= 5000);

-- Constraint de conteúdo não vazio
ALTER TABLE task_comments
DROP CONSTRAINT IF EXISTS content_not_empty;

ALTER TABLE task_comments
ADD CONSTRAINT content_not_empty CHECK (trim(content) != '');

-- Trigger para updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_task_comments_updated_at ON task_comments;

CREATE TRIGGER update_task_comments_updated_at
    BEFORE UPDATE ON task_comments
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Comentários
COMMENT ON COLUMN task_comments.updated_at IS 'Última atualização do comentário (edição)';
COMMENT ON COLUMN task_comments.deleted_at IS 'Soft delete timestamp. NULL = ativo, NOT NULL = deletado';
COMMENT ON COLUMN task_comments.editado IS 'Indica se comentário foi editado após criação';

-- Log
DO $$
BEGIN
    RAISE NOTICE '✅ Migration 1007: task_comments ajustada para ETAPA 3 (updated_at, deleted_at, editado)';
END $$;

COMMIT;
