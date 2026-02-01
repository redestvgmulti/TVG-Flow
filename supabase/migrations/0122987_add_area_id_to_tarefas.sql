-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- ADD area_id TO tarefas (FOUNDATIONAL)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ALTER TABLE tarefas
ADD COLUMN IF NOT EXISTS area_id UUID
REFERENCES areas(id)
ON DELETE SET NULL;

COMMENT ON COLUMN tarefas.area_id IS
  'Área/setor responsável pela tarefa (nullable para tarefas legadas)';