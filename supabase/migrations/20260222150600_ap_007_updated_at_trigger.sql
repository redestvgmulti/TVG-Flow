CREATE OR REPLACE FUNCTION ap.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

-- Trigger em todas as tabelas mutáveis do módulo
CREATE TRIGGER trg_ap_news_updated_at
  BEFORE UPDATE ON ap.candidate_news
  FOR EACH ROW EXECUTE FUNCTION ap.set_updated_at();

CREATE TRIGGER trg_ap_sources_updated_at
  BEFORE UPDATE ON ap.sources
  FOR EACH ROW EXECUTE FUNCTION ap.set_updated_at();

CREATE TRIGGER trg_ap_patrocinadores_updated_at
  BEFORE UPDATE ON ap.patrocinadores
  FOR EACH ROW EXECUTE FUNCTION ap.set_updated_at();
