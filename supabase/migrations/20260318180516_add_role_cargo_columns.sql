
ALTER TABLE empresa_profissionais ADD COLUMN IF NOT EXISTS role TEXT;
ALTER TABLE empresa_profissionais ADD COLUMN IF NOT EXISTS cargo TEXT;
ALTER TABLE tarefas_micro ADD COLUMN IF NOT EXISTS cargo TEXT;
;
