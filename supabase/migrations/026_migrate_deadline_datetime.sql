-- Migration: Migrate due_date to deadline_at with timestamp
-- Description: Change from date-only to timestamp with time zone for precise deadline tracking

-- Step 1: Add new column
ALTER TABLE tarefas
ADD COLUMN IF NOT EXISTS deadline_at TIMESTAMP WITH TIME ZONE;

-- Step 2: Migrate existing data (preserve date, set time to end of day)
UPDATE tarefas
SET deadline_at = (due_date::timestamp + interval '23 hours 59 minutes')::timestamp with time zone
WHERE due_date IS NOT NULL AND deadline_at IS NULL;

-- Step 3: Drop old column
ALTER TABLE tarefas
DROP COLUMN IF EXISTS due_date;

-- Step 4: Create index for deadline queries
CREATE INDEX IF NOT EXISTS idx_tarefas_deadline ON tarefas(deadline_at) 
WHERE deadline_at IS NOT NULL;

-- Comment
COMMENT ON COLUMN tarefas.deadline_at IS 'Task deadline with date and time (timestamp with timezone)';
