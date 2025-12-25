-- Create task_comments table for activity timeline
-- This allows professionals to add notes and comments to tasks

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Professionals view comments on accessible tasks" ON task_comments;
DROP POLICY IF EXISTS "Professionals insert comments on accessible tasks" ON task_comments;
DROP POLICY IF EXISTS "Admins manage all comments" ON task_comments;
DROP POLICY IF EXISTS "Service role manages all comments" ON task_comments;

-- Create table if not exists
CREATE TABLE IF NOT EXISTS task_comments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    task_id UUID NOT NULL REFERENCES tarefas(id) ON DELETE CASCADE,
    author_id UUID NOT NULL REFERENCES profissionais(id),
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes if not exist
CREATE INDEX IF NOT EXISTS idx_task_comments_task_id ON task_comments(task_id);
CREATE INDEX IF NOT EXISTS idx_task_comments_created_at ON task_comments(created_at DESC);

-- Enable RLS
ALTER TABLE task_comments ENABLE ROW LEVEL SECURITY;

-- Policy: Professionals can view comments on tasks they have access to
CREATE POLICY "Professionals view comments on accessible tasks"
ON task_comments FOR SELECT
TO authenticated
USING (
    -- Can view if they have access to the task
    task_id IN (
        SELECT id FROM tarefas 
        WHERE assigned_to = auth.uid() 
        OR created_by = auth.uid()
        OR EXISTS (
            SELECT 1 FROM tarefas_itens 
            WHERE tarefas_itens.tarefa_id = tarefas.id 
            AND tarefas_itens.profissional_id = auth.uid()
        )
        OR EXISTS (
            SELECT 1 FROM tarefas_micro 
            WHERE tarefas_micro.tarefa_id = tarefas.id 
            AND tarefas_micro.profissional_id = auth.uid()
        )
    )
);

-- Policy: Professionals can insert comments on tasks they have access to
CREATE POLICY "Professionals insert comments on accessible tasks"
ON task_comments FOR INSERT
TO authenticated
WITH CHECK (
    -- Must be active professional
    EXISTS (SELECT 1 FROM profissionais WHERE id = auth.uid() AND ativo = true)
    AND
    -- Can insert if they have access to the task
    task_id IN (
        SELECT id FROM tarefas 
        WHERE assigned_to = auth.uid() 
        OR created_by = auth.uid()
        OR EXISTS (
            SELECT 1 FROM tarefas_itens 
            WHERE tarefas_itens.tarefa_id = tarefas.id 
            AND tarefas_itens.profissional_id = auth.uid()
        )
        OR EXISTS (
            SELECT 1 FROM tarefas_micro 
            WHERE tarefas_micro.tarefa_id = tarefas.id 
            AND tarefas_micro.profissional_id = auth.uid()
        )
    )
    AND
    -- Author must be the authenticated user
    author_id = auth.uid()
);

-- Add comments
COMMENT ON TABLE task_comments IS 'Activity timeline and comments for tasks';
COMMENT ON COLUMN task_comments.task_id IS 'Reference to the task (macro task)';
COMMENT ON COLUMN task_comments.author_id IS 'Professional who wrote the comment';
COMMENT ON COLUMN task_comments.content IS 'Comment text';
