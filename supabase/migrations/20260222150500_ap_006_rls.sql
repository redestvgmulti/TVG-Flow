ALTER TABLE ap.candidate_news    ENABLE ROW LEVEL SECURITY;
ALTER TABLE ap.candidate_scores  ENABLE ROW LEVEL SECURITY;
ALTER TABLE ap.sources           ENABLE ROW LEVEL SECURITY;
ALTER TABLE ap.patrocinadores    ENABLE ROW LEVEL SECURITY;
ALTER TABLE ap.learning_history  ENABLE ROW LEVEL SECURITY;

-- Helper: clientes que o usuário autenticado pode acessar
-- Idêntico ao padrão existente no sistema
CREATE OR REPLACE FUNCTION ap.get_user_cliente_ids()
RETURNS SETOF UUID
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT cp.cliente_id
  FROM public.cliente_profissionais cp
  WHERE cp.profissional_id = auth.uid()
    AND cp.ativo = true;
$$;

-- candidate_news
CREATE POLICY "ap_news_tenant_isolation"
  ON ap.candidate_news FOR ALL TO authenticated
  USING (cliente_id IN (SELECT ap.get_user_cliente_ids()));

-- candidate_scores (acesso via news, não diretamente)
CREATE POLICY "ap_scores_tenant_isolation"
  ON ap.candidate_scores FOR ALL TO authenticated
  USING (cliente_id IN (SELECT ap.get_user_cliente_ids()));

-- sources
CREATE POLICY "ap_sources_tenant_isolation"
  ON ap.sources FOR ALL TO authenticated
  USING (cliente_id IN (SELECT ap.get_user_cliente_ids()));

-- patrocinadores
CREATE POLICY "ap_patrocinadores_tenant_isolation"
  ON ap.patrocinadores FOR ALL TO authenticated
  USING (cliente_id IN (SELECT ap.get_user_cliente_ids()));

-- learning_history
CREATE POLICY "ap_learning_tenant_isolation"
  ON ap.learning_history FOR ALL TO authenticated
  USING (cliente_id IN (SELECT ap.get_user_cliente_ids()));
