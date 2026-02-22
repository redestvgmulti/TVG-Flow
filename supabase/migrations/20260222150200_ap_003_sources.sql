CREATE TABLE IF NOT EXISTS ap.sources (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id  UUID NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
  nome        TEXT NOT NULL,
  tipo        TEXT NOT NULL DEFAULT 'rss' CHECK (tipo IN ('rss','google_news_rss')),
  url         TEXT NOT NULL,
  ativo       BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_ap_sources UNIQUE (cliente_id, url)
);

CREATE INDEX idx_ap_sources_cliente ON ap.sources(cliente_id) WHERE ativo = true;
