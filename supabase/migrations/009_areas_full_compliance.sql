-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 009_areas_full_compliance.sql
-- CORREÇÃO COMPLETA DE GOVERNANÇA POR ÁREAS
-- Este script aplica todas as colunas, índices e triggers que faltaram da migration 006
-- e garante que o banco fique 100% alinhado com o código.
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 1. ADICIONAR COLUNAS FALTANTES (SE NÃO EXISTIREM)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Profissionais -> Área
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profissionais' AND column_name = 'area_id') THEN
        ALTER TABLE profissionais ADD COLUMN area_id UUID REFERENCES areas(id);
    END IF;
END $$;

-- Tarefas -> Área Executora
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tarefas' AND column_name = 'area_id') THEN
        ALTER TABLE tarefas ADD COLUMN area_id UUID REFERENCES areas(id);
    END IF;
END $$;

-- Tarefas -> Solicitante (Requested By)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tarefas' AND column_name = 'requested_by') THEN
        ALTER TABLE tarefas ADD COLUMN requested_by UUID REFERENCES profissionais(id);
    END IF;
END $$;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 2. CRIAR ÍNDICES (PARA PERFORMANCE)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE INDEX IF NOT EXISTS idx_profissionais_area ON profissionais(area_id);
CREATE INDEX IF NOT EXISTS idx_tarefas_area ON tarefas(area_id);
CREATE INDEX IF NOT EXISTS idx_tarefas_requested_by ON tarefas(requested_by);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 3. INTERFACE DE SEGURANÇA (RLS)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Remover políticas antigas para garantir limpeza
DROP POLICY IF EXISTS "Professionals view own notifications" ON tarefas;
DROP POLICY IF EXISTS "Professionals update own notifications" ON tarefas;
DROP POLICY IF EXISTS "Admins view all notifications" ON tarefas;
DROP POLICY IF EXISTS "Profissionais veem tarefas do setor ou solicitadas" ON tarefas;
DROP POLICY IF EXISTS "Profissionais podem criar tarefas" ON tarefas;
DROP POLICY IF EXISTS "Profissionais atualizam tarefas do setor" ON tarefas;
DROP POLICY IF EXISTS "Admin acesso total tarefas" ON tarefas;

-- Recriar políticas corretas

-- Leitura: Vê tarefas do próprio setor OU que solicitou OU que não tem setor (legado)
CREATE POLICY "Profissionais veem tarefas"
ON tarefas FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profissionais p
    WHERE p.id = auth.uid()
      AND p.ativo = true
      AND (
        tarefas.area_id IS NULL           -- Legado
        OR p.area_id = tarefas.area_id    -- Meu setor
        OR tarefas.requested_by = p.id    -- Eu solicitei
      )
  )
);

-- Inserção: Qualquer profissional ativo pode criar tarefa
CREATE POLICY "Profissionais criam tarefas"
ON tarefas FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM profissionais
    WHERE id = auth.uid()
      AND ativo = true
  )
);

-- Atualização: Pode editar se for do seu setor
CREATE POLICY "Profissionais editam tarefas do setor"
ON tarefas FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profissionais p
    WHERE p.id = auth.uid()
      AND p.ativo = true
      AND p.area_id = tarefas.area_id
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM profissionais p
    WHERE p.id = auth.uid()
      AND p.ativo = true
      AND p.area_id = tarefas.area_id
  )
);

-- Admin: Acesso total
CREATE POLICY "Admin total"
ON tarefas FOR ALL
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
-- 4. AUTOMAÇÃO E TRIGGERS
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Função para auto-preencher solicitante
CREATE OR REPLACE FUNCTION set_requested_by_if_null()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.requested_by IS NULL THEN
    NEW.requested_by := auth.uid();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_set_requested_by ON tarefas;
CREATE TRIGGER trigger_set_requested_by
BEFORE INSERT ON tarefas
FOR EACH ROW
EXECUTE FUNCTION set_requested_by_if_null();

-- Função de Notificação (Cross-Setor)
CREATE OR REPLACE FUNCTION notify_task_requested()
RETURNS TRIGGER AS $$
BEGIN
  -- Se tem solicitante E setor definido
  IF NEW.requested_by IS NOT NULL AND NEW.area_id IS NOT NULL THEN
     -- Se solicitante NÃO for do mesmo setor da tarefa (cross-setor)
     IF (SELECT p.area_id FROM profissionais p WHERE p.id = NEW.requested_by) IS DISTINCT FROM NEW.area_id THEN
        INSERT INTO notifications (profissional_id, type, title, message, entity_type, entity_id)
        SELECT p.id, 'task_requested', 'Nova solicitação recebida', NEW.titulo, 'task', NEW.id
        FROM profissionais p
        WHERE p.area_id = NEW.area_id AND p.ativo = true AND p.id != NEW.requested_by;
     END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_notify_task_requested ON tarefas;
CREATE TRIGGER trigger_notify_task_requested
AFTER INSERT ON tarefas
FOR EACH ROW
EXECUTE FUNCTION notify_task_requested();

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 5. VALIDAÇÃO FINAL
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

COMMENT ON COLUMN profissionais.area_id IS 'Área do profissional';
COMMENT ON COLUMN tarefas.area_id IS 'Área executora';
COMMENT ON COLUMN tarefas.requested_by IS 'Solicitante da tarefa';

DO $$
BEGIN
    RAISE NOTICE 'Migration 009 aplicada com sucesso: Schema completo!';
END $$;
