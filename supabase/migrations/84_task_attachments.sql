-- Migration: Task Attachments System
-- Description: Add support for file uploads to tasks with secure multi-tenant access
-- Author: System
-- Date: 2026-01-10

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create task_attachments table
CREATE TABLE IF NOT EXISTS task_attachments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tarefa_id UUID NOT NULL REFERENCES tarefas(id) ON DELETE CASCADE,
  empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  uploaded_by UUID NOT NULL REFERENCES profissionais(id),
  
  -- File metadata
  filename TEXT NOT NULL, -- UUID-based filename in storage
  original_filename TEXT NOT NULL, -- User's original filename
  file_size INTEGER NOT NULL, -- Size in bytes
  mime_type TEXT NOT NULL,
  storage_path TEXT NOT NULL, -- Full path: {empresa_id}/{tarefa_id}/{uuid}_{filename}
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT task_attachments_file_size_check CHECK (file_size > 0 AND file_size <= 10485760), -- Max 10MB
  CONSTRAINT task_attachments_filename_not_empty CHECK (length(filename) > 0),
  CONSTRAINT task_attachments_original_filename_not_empty CHECK (length(original_filename) > 0)
);

-- Indexes for performance
CREATE INDEX idx_task_attachments_tarefa ON task_attachments(tarefa_id);
CREATE INDEX idx_task_attachments_empresa ON task_attachments(empresa_id);
CREATE INDEX idx_task_attachments_uploaded_by ON task_attachments(uploaded_by);
CREATE INDEX idx_task_attachments_created_at ON task_attachments(created_at DESC);

-- Comments
COMMENT ON TABLE task_attachments IS 'Stores metadata for files attached to tasks';
COMMENT ON COLUMN task_attachments.filename IS 'UUID-based filename stored in Supabase Storage';
COMMENT ON COLUMN task_attachments.original_filename IS 'Original filename uploaded by user';
COMMENT ON COLUMN task_attachments.storage_path IS 'Full path in storage bucket: {empresa_id}/{tarefa_id}/{uuid}_{filename}';
COMMENT ON COLUMN task_attachments.file_size IS 'File size in bytes (max 10MB)';

-- Enable RLS
ALTER TABLE task_attachments ENABLE ROW LEVEL SECURITY;

-- RLS Policies

-- SELECT: Staff can view attachments from their company's tasks
CREATE POLICY "Staff can view company task attachments"
ON task_attachments FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM empresa_profissionais ep
    WHERE ep.profissional_id = auth.uid()
    AND ep.empresa_id = task_attachments.empresa_id
    AND ep.ativo = true
  )
);

-- INSERT: Users can upload to their company's tasks
CREATE POLICY "Users can upload to company tasks"
ON task_attachments FOR INSERT
WITH CHECK (
  uploaded_by = auth.uid() AND
  EXISTS (
    SELECT 1 FROM empresa_profissionais ep
    WHERE ep.profissional_id = auth.uid()
    AND ep.empresa_id = task_attachments.empresa_id
    AND ep.ativo = true
  )
);

-- DELETE: Users can delete their own uploads OR admins can delete any from their company
CREATE POLICY "Users can delete own uploads or admins can delete company uploads"
ON task_attachments FOR DELETE
USING (
  uploaded_by = auth.uid() OR
  EXISTS (
    SELECT 1 FROM empresa_profissionais ep
    JOIN profissionais p ON p.id = ep.profissional_id
    WHERE ep.profissional_id = auth.uid()
    AND ep.empresa_id = task_attachments.empresa_id
    AND ep.ativo = true
    AND p.role = 'admin'
  )
);

-- Grant permissions
GRANT SELECT, INSERT, DELETE ON task_attachments TO authenticated;
