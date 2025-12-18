-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- TVG Flow - Migration 013
-- Add drive_link column to tarefas table
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- ADD COLUMN: drive_link to tarefas
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Add drive_link column to store Google Drive links directly in tasks
ALTER TABLE tarefas 
ADD COLUMN IF NOT EXISTS drive_link TEXT;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- MIGRATE EXISTING DATA (if any)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Migrate final_drive_link from arquivos_tarefas to tarefas.drive_link
-- This prioritizes final_drive_link, falls back to research_drive_link if final is null
UPDATE tarefas t
SET drive_link = COALESCE(
    (SELECT final_drive_link FROM arquivos_tarefas WHERE tarefa_id = t.id LIMIT 1),
    (SELECT research_drive_link FROM arquivos_tarefas WHERE tarefa_id = t.id LIMIT 1)
)
WHERE EXISTS (
    SELECT 1 FROM arquivos_tarefas WHERE tarefa_id = t.id
)
AND drive_link IS NULL;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- COMMENTS
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

COMMENT ON COLUMN tarefas.drive_link IS 'Google Drive link for task files and resources';

-- Note: arquivos_tarefas table is kept for backward compatibility
-- New implementations should use tarefas.drive_link directly
