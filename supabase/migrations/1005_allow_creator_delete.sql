-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- Migration: Allow Task Creators to Delete Their Tasks
-- Data: 2026-01-07
-- Descrição: Permite que quem criou a tarefa também possa excluí-la, além dos admins
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

BEGIN;

-- Drop existing restrictive DELETE policy
DROP POLICY IF EXISTS "Only admins delete tasks" ON tarefas;

-- Create new policy allowing both admins AND task creators to delete
CREATE POLICY "Admins and creators can delete tasks"
ON tarefas FOR DELETE
TO authenticated
USING (
  -- Admin can delete all tasks
  EXISTS (
    SELECT 1 FROM profissionais
    WHERE id = auth.uid()
      AND role = 'admin'
      AND ativo = true
  )
  OR
  -- Task creator can delete their own tasks
  created_by = auth.uid()
);

-- Update comment
COMMENT ON POLICY "Admins and creators can delete tasks" ON tarefas IS 
'Admins can delete all tasks. Task creators can delete only the tasks they created.';

-- Log
DO $$
BEGIN
    RAISE NOTICE 'DELETE permission granted to task creators.';
END $$;

COMMIT;
