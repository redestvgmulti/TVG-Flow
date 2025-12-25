-- Add drive_link column to tarefas_micro table
-- This allows micro tasks to have their own file links

ALTER TABLE tarefas_micro ADD COLUMN IF NOT EXISTS drive_link TEXT;

COMMENT ON COLUMN tarefas_micro.drive_link IS 'Optional link to Google Drive or other file storage for this micro task';
