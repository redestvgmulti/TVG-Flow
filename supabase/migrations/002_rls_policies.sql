-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- TVG Flow - Row Level Security (RLS)
-- Políticas de segurança baseadas em roles
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Habilitar RLS em todas as tabelas
ALTER TABLE clientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE departamentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE profissionais ENABLE ROW LEVEL SECURITY;
ALTER TABLE tarefas ENABLE ROW LEVEL SECURITY;
ALTER TABLE arquivos_tarefas ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE logs_tarefas ENABLE ROW LEVEL SECURITY;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- HELPER FUNCTIONS
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Função para verificar se o usuário é admin
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM profissionais
    WHERE id = auth.uid()
    AND role = 'admin'
    AND ativo = true
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Função para verificar se o usuário é profissional ativo
CREATE OR REPLACE FUNCTION is_active_profissional()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM profissionais
    WHERE id = auth.uid()
    AND ativo = true
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- POLÍTICAS: profissionais
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Admin: acesso total
CREATE POLICY "Admin tem acesso total a profissionais"
  ON profissionais FOR ALL
  USING (is_admin())
  WITH CHECK (is_admin());

-- Profissional: pode ver apenas seu próprio registro
CREATE POLICY "Profissional pode ver próprio registro"
  ON profissionais FOR SELECT
  USING (id = auth.uid() AND ativo = true);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- POLÍTICAS: clientes
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Admin: acesso total
CREATE POLICY "Admin tem acesso total a clientes"
  ON clientes FOR ALL
  USING (is_admin())
  WITH CHECK (is_admin());

-- Profissional: apenas visualização
CREATE POLICY "Profissional pode visualizar clientes"
  ON clientes FOR SELECT
  USING (is_active_profissional());

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- POLÍTICAS: departamentos
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Admin: acesso total
CREATE POLICY "Admin tem acesso total a departamentos"
  ON departamentos FOR ALL
  USING (is_admin())
  WITH CHECK (is_admin());

-- Profissional: apenas visualização
CREATE POLICY "Profissional pode visualizar departamentos"
  ON departamentos FOR SELECT
  USING (is_active_profissional());

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- POLÍTICAS: tarefas
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Admin: acesso total
CREATE POLICY "Admin tem acesso total a tarefas"
  ON tarefas FOR ALL
  USING (is_admin())
  WITH CHECK (is_admin());

-- Profissional: pode ver tarefas atribuídas a ele
CREATE POLICY "Profissional pode ver tarefas atribuídas"
  ON tarefas FOR SELECT
  USING (
    is_active_profissional() AND 
    (assigned_to = auth.uid() OR created_by = auth.uid())
  );

-- Profissional: pode criar solicitações de tarefas
CREATE POLICY "Profissional pode criar solicitações"
  ON tarefas FOR INSERT
  WITH CHECK (
    is_active_profissional() AND 
    created_by = auth.uid()
  );

-- Profissional: pode atualizar status de tarefas atribuídas a ele
CREATE POLICY "Profissional pode atualizar tarefas atribuídas"
  ON tarefas FOR UPDATE
  USING (
    is_active_profissional() AND 
    assigned_to = auth.uid()
  )
  WITH CHECK (
    is_active_profissional() AND 
    assigned_to = auth.uid()
  );

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- POLÍTICAS: arquivos_tarefas
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Admin: acesso total
CREATE POLICY "Admin tem acesso total a arquivos"
  ON arquivos_tarefas FOR ALL
  USING (is_admin())
  WITH CHECK (is_admin());

-- Profissional: pode ver arquivos de tarefas atribuídas a ele
CREATE POLICY "Profissional pode ver arquivos de suas tarefas"
  ON arquivos_tarefas FOR SELECT
  USING (
    is_active_profissional() AND
    EXISTS (
      SELECT 1 FROM tarefas
      WHERE tarefas.id = arquivos_tarefas.tarefa_id
      AND (tarefas.assigned_to = auth.uid() OR tarefas.created_by = auth.uid())
    )
  );

-- Profissional: pode criar/atualizar arquivos de tarefas atribuídas a ele
CREATE POLICY "Profissional pode gerenciar arquivos de suas tarefas"
  ON arquivos_tarefas FOR INSERT
  WITH CHECK (
    is_active_profissional() AND
    EXISTS (
      SELECT 1 FROM tarefas
      WHERE tarefas.id = arquivos_tarefas.tarefa_id
      AND tarefas.assigned_to = auth.uid()
    )
  );

CREATE POLICY "Profissional pode atualizar arquivos de suas tarefas"
  ON arquivos_tarefas FOR UPDATE
  USING (
    is_active_profissional() AND
    EXISTS (
      SELECT 1 FROM tarefas
      WHERE tarefas.id = arquivos_tarefas.tarefa_id
      AND tarefas.assigned_to = auth.uid()
    )
  )
  WITH CHECK (
    is_active_profissional() AND
    EXISTS (
      SELECT 1 FROM tarefas
      WHERE tarefas.id = arquivos_tarefas.tarefa_id
      AND tarefas.assigned_to = auth.uid()
    )
  );

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- POLÍTICAS: push_subscriptions
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Cada profissional pode gerenciar apenas suas próprias subscriptions
CREATE POLICY "Profissional gerencia próprias subscriptions"
  ON push_subscriptions FOR ALL
  USING (profissional_id = auth.uid())
  WITH CHECK (profissional_id = auth.uid());

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- POLÍTICAS: logs_tarefas
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Admin: pode ver todos os logs
CREATE POLICY "Admin pode ver todos os logs"
  ON logs_tarefas FOR SELECT
  USING (is_admin());

-- Profissional: pode ver logs de suas tarefas
CREATE POLICY "Profissional pode ver logs de suas tarefas"
  ON logs_tarefas FOR SELECT
  USING (
    is_active_profissional() AND
    EXISTS (
      SELECT 1 FROM tarefas
      WHERE tarefas.id = logs_tarefas.tarefa_id
      AND (tarefas.assigned_to = auth.uid() OR tarefas.created_by = auth.uid())
    )
  );

-- Sistema pode inserir logs (via triggers)
CREATE POLICY "Sistema pode inserir logs"
  ON logs_tarefas FOR INSERT
  WITH CHECK (true);
