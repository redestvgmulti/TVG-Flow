CREATE TABLE IF NOT EXISTS ap.patrocinadores (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id      UUID NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
  nome            TEXT NOT NULL,
  template_id     TEXT,
  logo_url        TEXT,
  ativo           BOOLEAN DEFAULT true,
  ultimo_uso_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Seleção atômica sem race condition (FOR UPDATE SKIP LOCKED)
CREATE OR REPLACE FUNCTION ap.select_sponsor(p_cliente_id UUID)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id
  FROM ap.patrocinadores
  WHERE cliente_id = p_cliente_id AND ativo = true
  ORDER BY ultimo_uso_at ASC NULLS FIRST
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF v_id IS NOT NULL THEN
    UPDATE ap.patrocinadores SET ultimo_uso_at = NOW() WHERE id = v_id;
  END IF;

  RETURN v_id;
END;
$$;
