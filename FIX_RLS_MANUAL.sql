-- Execute este SQL diretamente no Supabase SQL Editor
-- para verificar e corrigir as políticas RLS

-- 1. Verificar políticas atuais
SELECT 
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual
FROM pg_policies 
WHERE tablename = 'tarefas'
ORDER BY policyname;

-- 2. Remover TODAS as políticas antigas
DROP POLICY IF EXISTS "Profissionais veem tarefas" ON tarefas;
DROP POLICY IF EXISTS "Profissionais criam tarefas" ON tarefas;
DROP POLICY IF EXISTS "Profissionais editam tarefas do setor" ON tarefas;
DROP POLICY IF EXISTS "Profissional pode ver tarefas atribuídas" ON tarefas;
DROP POLICY IF EXISTS "Profissional pode atualizar tarefas atribuídas" ON tarefas;
DROP POLICY IF EXISTS "Admin acesso total tarefas" ON tarefas;
DROP POLICY IF EXISTS "Admin total" ON tarefas;
DROP POLICY IF EXISTS "Professionals see only assigned tasks via micro-tasks" ON tarefas;
DROP POLICY IF EXISTS "Professionals update only assigned tasks" ON tarefas;
DROP POLICY IF EXISTS "Only admins create tasks" ON tarefas;
DROP POLICY IF EXISTS "Only admins delete tasks" ON tarefas;

-- 3. Criar políticas corretas e simples

-- SELECT: Profissionais veem apenas tarefas com micro-task atribuída
CREATE POLICY "staff_select_assigned_tasks"
ON tarefas FOR SELECT
TO authenticated
USING (
  -- Admin vê tudo
  (SELECT role FROM profissionais WHERE id = auth.uid()) = 'admin'
  OR
  -- Profissional vê apenas se tem micro-task
  EXISTS (
    SELECT 1 FROM tarefas_itens
    WHERE tarefas_itens.tarefa_id = tarefas.id
      AND tarefas_itens.profissional_id = auth.uid()
  )
);

-- UPDATE: Profissionais atualizam apenas tarefas atribuídas
CREATE POLICY "staff_update_assigned_tasks"
ON tarefas FOR UPDATE
TO authenticated
USING (
  (SELECT role FROM profissionais WHERE id = auth.uid()) = 'admin'
  OR
  EXISTS (
    SELECT 1 FROM tarefas_itens
    WHERE tarefas_itens.tarefa_id = tarefas.id
      AND tarefas_itens.profissional_id = auth.uid()
  )
)
WITH CHECK (
  (SELECT role FROM profissionais WHERE id = auth.uid()) = 'admin'
  OR
  EXISTS (
    SELECT 1 FROM tarefas_itens
    WHERE tarefas_itens.tarefa_id = tarefas.id
      AND tarefas_itens.profissional_id = auth.uid()
  )
);

-- INSERT: Apenas admins criam tarefas
CREATE POLICY "admin_insert_tasks"
ON tarefas FOR INSERT
TO authenticated
WITH CHECK (
  (SELECT role FROM profissionais WHERE id = auth.uid()) = 'admin'
);

-- DELETE: Apenas admins deletam tarefas
CREATE POLICY "admin_delete_tasks"
ON tarefas FOR DELETE
TO authenticated
USING (
  (SELECT role FROM profissionais WHERE id = auth.uid()) = 'admin'
);

-- 4. Verificar se funcionou
SELECT 
    policyname,
    cmd,
    CASE 
        WHEN policyname LIKE '%admin%' THEN 'Admin only'
        WHEN policyname LIKE '%staff%' THEN 'Staff with micro-tasks'
        ELSE 'Other'
    END as policy_type
FROM pg_policies 
WHERE tablename = 'tarefas'
ORDER BY cmd, policyname;

-- 5. Testar como profissional (substitua o UUID pelo ID real)
-- SET LOCAL role = 'authenticated';
-- SET LOCAL request.jwt.claims = '{"sub": "SEU_PROFISSIONAL_UUID_AQUI"}';
-- SELECT * FROM tarefas;
-- RESET role;
