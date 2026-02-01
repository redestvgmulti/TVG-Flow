-- Migration: Fix Staff Task Visibility - Critical Security
-- Description: Ensure professionals can ONLY see tasks assigned to them via micro-tasks

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 1. DROP OLD PERMISSIVE POLICIES
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

DROP POLICY IF EXISTS "Profissionais veem tarefas" ON tarefas;
DROP POLICY IF EXISTS "Profissionais criam tarefas" ON tarefas;
DROP POLICY IF EXISTS "Profissionais editam tarefas do setor" ON tarefas;
DROP POLICY IF EXISTS "Profissional pode ver tarefas atribuídas" ON tarefas;
DROP POLICY IF EXISTS "Profissional pode atualizar tarefas atribuídas" ON tarefas;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 2. CREATE STRICT POLICIES - PROFESSIONALS SEE ONLY THEIR ASSIGNED TASKS
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- SELECT: Professionals can ONLY see tasks where they have a micro-task assigned
CREATE POLICY "Professionals see only assigned tasks via micro-tasks"
ON tarefas FOR SELECT
TO authenticated
USING (
  -- Admin sees all
  EXISTS (
    SELECT 1 FROM profissionais
    WHERE id = auth.uid()
      AND role = 'admin'
      AND ativo = true
  )
  OR
  -- Professional sees only if they have a micro-task for this task
  EXISTS (
    SELECT 1 FROM tarefas_itens ti
    WHERE ti.tarefa_id = tarefas.id
      AND ti.profissional_id = auth.uid()
  )
);

-- UPDATE: Professionals can ONLY update tasks where they have a micro-task
CREATE POLICY "Professionals update only assigned tasks"
ON tarefas FOR UPDATE
TO authenticated
USING (
  -- Admin can update all
  EXISTS (
    SELECT 1 FROM profissionais
    WHERE id = auth.uid()
      AND role = 'admin'
      AND ativo = true
  )
  OR
  -- Professional can update if they have a micro-task
  EXISTS (
    SELECT 1 FROM tarefas_itens ti
    WHERE ti.tarefa_id = tarefas.id
      AND ti.profissional_id = auth.uid()
  )
)
WITH CHECK (
  -- Same check for WITH CHECK
  EXISTS (
    SELECT 1 FROM profissionais
    WHERE id = auth.uid()
      AND role = 'admin'
      AND ativo = true
  )
  OR
  EXISTS (
    SELECT 1 FROM tarefas_itens ti
    WHERE ti.tarefa_id = tarefas.id
      AND ti.profissional_id = auth.uid()
  )
);

-- INSERT: Only admins can create tasks (professionals should not create tasks directly)
CREATE POLICY "Only admins create tasks"
ON tarefas FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM profissionais
    WHERE id = auth.uid()
      AND role = 'admin'
      AND ativo = true
  )
);

-- DELETE: Only admins can delete tasks
CREATE POLICY "Only admins delete tasks"
ON tarefas FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profissionais
    WHERE id = auth.uid()
      AND role = 'admin'
      AND ativo = true
  )
);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 3. VERIFY MICRO-TASKS RLS IS ALSO STRICT
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Ensure the existing micro-tasks policies are correct
-- (These should already be in place from migration 023)

-- Verify: Professionals can view their micro-tasks
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'tarefas_itens' 
    AND policyname = 'Professionals can view their micro-tasks'
  ) THEN
    RAISE WARNING 'Policy "Professionals can view their micro-tasks" not found on tarefas_itens';
  END IF;
END $$;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 4. COMMENTS
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

COMMENT ON POLICY "Professionals see only assigned tasks via micro-tasks" ON tarefas IS 
'CRITICAL SECURITY: Professionals can ONLY see tasks where they have a micro-task assigned. This prevents staff from seeing other staff members tasks.';

COMMENT ON POLICY "Professionals update only assigned tasks" ON tarefas IS 
'Professionals can only update tasks they are assigned to via micro-tasks';

COMMENT ON POLICY "Only admins create tasks" ON tarefas IS 
'Task creation is restricted to admins only';

-- Success message
DO $$
BEGIN
  RAISE NOTICE '✅ Migration 029: Staff task visibility fixed - professionals can now ONLY see their assigned tasks';
END $$;
