-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- GOVERNANÇA POR ÁREAS
-- Sistema de setores com solicitações intersetoriais
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- TABELA: areas (setores)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE TABLE IF NOT EXISTS areas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL,
  ativo BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índice para buscas
CREATE INDEX idx_areas_ativo ON areas(ativo);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- ALTERAÇÕES: profissionais → área
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ALTER TABLE profissionais
ADD COLUMN IF NOT EXISTS area_id UUID REFERENCES areas(id);

CREATE INDEX idx_profissionais_area ON profissionais(area_id);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- ALTERAÇÕES: tarefas → área executora + solicitante
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ALTER TABLE tarefas
ADD COLUMN IF NOT EXISTS area_id UUID REFERENCES areas(id);

ALTER TABLE tarefas
ADD COLUMN IF NOT EXISTS requested_by UUID REFERENCES profissionais(id);

CREATE INDEX idx_tarefas_area ON tarefas(area_id);
CREATE INDEX idx_tarefas_requested_by ON tarefas(requested_by);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- RLS: Remover políticas antigas de tarefas
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

DROP POLICY IF EXISTS "Professionals view own notifications" ON tarefas;
DROP POLICY IF EXISTS "Professionals update own notifications" ON tarefas;
DROP POLICY IF EXISTS "Admins view all notifications" ON tarefas;
DROP POLICY IF EXISTS "Admins insert notifications" ON tarefas;
DROP POLICY IF EXISTS "System insert notifications" ON tarefas;

-- Nota: Mantém políticas existentes se tiverem nomes diferentes

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- RLS: Novas políticas de tarefas (governança por áreas)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Profissionais veem tarefas do seu setor OU que solicitaram
CREATE POLICY "Profissionais veem tarefas do setor ou solicitadas"
ON tarefas FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profissionais p
    WHERE p.id = auth.uid()
      AND p.ativo = true
      AND (
        p.area_id = tarefas.area_id
        OR tarefas.requested_by = p.id
      )
  )
);

-- Profissionais podem inserir tarefas
CREATE POLICY "Profissionais podem criar tarefas"
ON tarefas FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM profissionais
    WHERE id = auth.uid()
      AND ativo = true
  )
);

-- Profissionais podem atualizar tarefas do seu setor
CREATE POLICY "Profissionais atualizam tarefas do setor"
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

-- Admin acesso total
CREATE POLICY "Admin acesso total tarefas"
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
-- TRIGGER: Solicitação criada (notifica setor executor)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE OR REPLACE FUNCTION notify_task_requested()
RETURNS TRIGGER AS $$
BEGIN
  -- Apenas se for solicitação cross-setor
  IF NEW.requested_by IS NOT NULL AND NEW.area_id IS NOT NULL THEN
    -- Notificar todos os profissionais ativos do setor executor
    INSERT INTO notifications (
      profissional_id,
      type,
      title,
      message,
      entity_type,
      entity_id
    )
    SELECT
      p.id,
      'task_requested',
      'Nova solicitação de outro setor',
      NEW.titulo,
      'task',
      NEW.id
    FROM profissionais p
    WHERE p.area_id = NEW.area_id
      AND p.ativo = true
      AND p.id != NEW.requested_by; -- Não notificar o próprio solicitante
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
-- TRIGGER: Solicitação aceita (notifica solicitante)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE OR REPLACE FUNCTION notify_task_accepted()
RETURNS TRIGGER AS $$
BEGIN
  -- Quando status muda de pending para in_progress
  IF (OLD.status = 'pending' OR OLD.status IS NULL)
     AND NEW.status = 'in_progress'
     AND NEW.requested_by IS NOT NULL THEN
    INSERT INTO notifications (
      profissional_id,
      type,
      title,
      message,
      entity_type,
      entity_id
    )
    VALUES (
      NEW.requested_by,
      'task_accepted',
      'Sua solicitação foi aceita',
      NEW.titulo,
      'task',
      NEW.id
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_notify_task_accepted ON tarefas;

CREATE TRIGGER trigger_notify_task_accepted
AFTER UPDATE ON tarefas
FOR EACH ROW
EXECUTE FUNCTION notify_task_accepted();

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- TRIGGER: Solicitação concluída (notifica solicitante)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE OR REPLACE FUNCTION notify_task_completed_requester()
RETURNS TRIGGER AS $$
BEGIN
  -- Quando tarefa é concluída e tem solicitante
  IF NEW.status = 'completed'
     AND (OLD.status IS NULL OR OLD.status != 'completed')
     AND NEW.requested_by IS NOT NULL THEN
    INSERT INTO notifications (
      profissional_id,
      type,
      title,
      message,
      entity_type,
      entity_id
    )
    VALUES (
      NEW.requested_by,
      'task_completed',
      'Sua solicitação foi concluída',
      NEW.titulo,
      'task',
      NEW.id
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_notify_task_completed_requester ON tarefas;

CREATE TRIGGER trigger_notify_task_completed_requester
AFTER UPDATE ON tarefas
FOR EACH ROW
EXECUTE FUNCTION notify_task_completed_requester();

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- COMENTÁRIOS
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

COMMENT ON TABLE areas IS 'Áreas/setores da organização';
COMMENT ON COLUMN areas.nome IS 'Nome da área (ex: Marketing, TI, RH)';

COMMENT ON COLUMN profissionais.area_id IS 'Área/setor do profissional';

COMMENT ON COLUMN tarefas.area_id IS 'Área/setor executor da tarefa';
COMMENT ON COLUMN tarefas.requested_by IS 'Profissional que solicitou a tarefa (cross-setor)';
