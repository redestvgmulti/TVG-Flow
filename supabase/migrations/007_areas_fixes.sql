-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- CORREÇÕES CRÍTICAS - GOVERNANÇA POR ÁREAS
-- Blindagem contra bugs silenciosos e dados legados
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 1️⃣ CORREÇÃO: RLS de tarefas (suporte a area_id NULL)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Remover policy antiga
DROP POLICY IF EXISTS "Profissionais veem tarefas do setor ou solicitadas" ON tarefas;

-- Criar policy corrigida (suporta area_id NULL)
CREATE POLICY "Profissionais veem tarefas do setor ou solicitadas"
ON tarefas FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profissionais p
    WHERE p.id = auth.uid()
      AND p.ativo = true
      AND (
        tarefas.area_id IS NULL           -- Tarefas legadas sem área
        OR p.area_id = tarefas.area_id    -- Tarefas do mesmo setor
        OR tarefas.requested_by = p.id    -- Solicitações criadas pelo profissional
      )
  )
);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 2️⃣ CORREÇÃO: Auto-preencher requested_by
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE OR REPLACE FUNCTION set_requested_by_if_null()
RETURNS TRIGGER AS $$
BEGIN
  -- Se requested_by não foi preenchido, usar o usuário atual
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

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 3️⃣ CORREÇÃO: Notificar apenas solicitações cross-setor
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE OR REPLACE FUNCTION notify_task_requested()
RETURNS TRIGGER AS $$
DECLARE
  requester_area UUID;
BEGIN
  -- Apenas se for solicitação cross-setor
  IF NEW.requested_by IS NOT NULL AND NEW.area_id IS NOT NULL THEN
    -- Buscar área do solicitante
    SELECT area_id INTO requester_area
    FROM profissionais
    WHERE id = NEW.requested_by;

    -- Notificar apenas se for de OUTRO setor
    IF requester_area IS DISTINCT FROM NEW.area_id THEN
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
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger já existe, apenas atualizamos a função

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- COMENTÁRIOS
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

COMMENT ON FUNCTION set_requested_by_if_null() IS 'Auto-preenche requested_by com usuário atual se NULL';
COMMENT ON FUNCTION notify_task_requested() IS 'Notifica setor executor apenas em solicitações cross-setor';
