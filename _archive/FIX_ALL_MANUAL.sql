-- FIX_ALL_MANUAL.sql
-- Execute este script no Supabase SQL Editor para corrigir COMPLETAMENTE o banco de dados.

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 1. CRIAR TABELA TAREFAS_ITENS (SE NÃO EXISTIR)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE TABLE IF NOT EXISTS tarefas_itens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tarefa_id UUID NOT NULL REFERENCES tarefas(id) ON DELETE CASCADE,
    profissional_id UUID NOT NULL REFERENCES profissionais(id) ON DELETE CASCADE,
    status VARCHAR(20) DEFAULT 'pendente' CHECK (status IN ('pendente', 'concluida')),
    entrega_link TEXT,
    observacoes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    concluida_at TIMESTAMP WITH TIME ZONE,
    UNIQUE(tarefa_id, profissional_id)
);

-- Índices (Se não existirem)
CREATE INDEX IF NOT EXISTS idx_tarefas_itens_tarefa ON tarefas_itens(tarefa_id);
CREATE INDEX IF NOT EXISTS idx_tarefas_itens_profissional ON tarefas_itens(profissional_id);
CREATE INDEX IF NOT EXISTS idx_tarefas_itens_status ON tarefas_itens(status);

-- Ativar RLS na tabela tarefas_itens
ALTER TABLE tarefas_itens ENABLE ROW LEVEL SECURITY;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 2. CORRIGIR RLS DA TABELA TAREFAS (CRÍTICO)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Remover políticas antigas
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
DROP POLICY IF EXISTS "staff_select_assigned_tasks" ON tarefas;
DROP POLICY IF EXISTS "staff_update_assigned_tasks" ON tarefas;
DROP POLICY IF EXISTS "admin_delete_tasks" ON tarefas;
DROP POLICY IF EXISTS "admin_insert_tasks" ON tarefas;

-- Criar políticas corretas

-- SELECT: Profissionais veem apenas tarefas com micro-task atribuída
CREATE POLICY "staff_select_assigned_tasks_v2"
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
CREATE POLICY "staff_update_assigned_tasks_v2"
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
CREATE POLICY "admin_insert_tasks_v2"
ON tarefas FOR INSERT
TO authenticated
WITH CHECK (
  (SELECT role FROM profissionais WHERE id = auth.uid()) = 'admin'
);

-- DELETE: Apenas admins deletam tarefas
CREATE POLICY "admin_delete_tasks_v2"
ON tarefas FOR DELETE
TO authenticated
USING (
  (SELECT role FROM profissionais WHERE id = auth.uid()) = 'admin'
);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 3. CORRIGIR RLS DA TABELA TAREFAS_ITENS
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Remover políticas antigas
DROP POLICY IF EXISTS "Admin can manage all micro-tasks" ON tarefas_itens;
DROP POLICY IF EXISTS "Professionals can view their micro-tasks" ON tarefas_itens;
DROP POLICY IF EXISTS "Professionals can update their micro-tasks" ON tarefas_itens;

-- Criar políticas
CREATE POLICY "admin_manage_items"
ON tarefas_itens FOR ALL
TO authenticated
USING (
    (SELECT role FROM profissionais WHERE id = auth.uid()) = 'admin'
);

CREATE POLICY "staff_view_own_items"
ON tarefas_itens FOR SELECT
TO authenticated
USING (profissional_id = auth.uid());

CREATE POLICY "staff_update_own_items"
ON tarefas_itens FOR UPDATE
TO authenticated
USING (profissional_id = auth.uid())
WITH CHECK (profissional_id = auth.uid());

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 4. VERIFICAÇÃO FINA L
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

SELECT 
    tablename,
    policyname,
    cmd
FROM pg_policies 
WHERE tablename IN ('tarefas', 'tarefas_itens')
ORDER BY tablename, cmd;
