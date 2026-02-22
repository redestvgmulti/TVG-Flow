-- Schema isolado para o módulo AutoPublisher
CREATE SCHEMA IF NOT EXISTS ap;

-- Tabela principal: um registro por notícia, lifecycle completo via status
CREATE TABLE IF NOT EXISTS ap.candidate_news (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id          UUID NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
  status              TEXT NOT NULL DEFAULT 'raw' CHECK (status IN (
                        'raw','ready_for_scoring','scored','selected',
                        'pending_render','pending_review','approved',
                        'queued_for_posting','posted','rejected')),
  -- Ingestão
  titulo              TEXT NOT NULL,
  conteudo            TEXT,
  url_original        TEXT NOT NULL,
  imagem_url          TEXT,         -- URL externa original
  imagem_storage      TEXT,         -- Path no Supabase Storage
  published_at        TIMESTAMPTZ,
  fonte_id            UUID,         -- FK → ap.sources
  -- Editorial
  categoria           TEXT CHECK (categoria IN (
                        'regional','nacional_relevante','engajamento_alto','global_contextual')),
  posicao_feed        INT,
  -- Conteúdo gerado por IA (Camada 7)
  headline            TEXT,         -- 50-65 chars
  caption             TEXT,
  roteiro_json        JSONB,
  visual_energy_level TEXT CHECK (visual_energy_level IN ('low','medium','high')),
  has_face            BOOLEAN DEFAULT false,
  -- Render (Camada 8)
  patrocinador_id     UUID,
  render_url          TEXT,
  -- Agendamento e publicação (Camadas 10-11)
  horario_agendado       TIMESTAMPTZ,
  instagram_post_id      TEXT,
  -- Self-healing: detectar registros presos por crash do worker
  processing_started_at  TIMESTAMPTZ,
  -- Auditoria
  created_at             TIMESTAMPTZ DEFAULT NOW(),
  updated_at             TIMESTAMPTZ DEFAULT NOW(),
  -- Deduplicação: mesma URL nunca é ingerida duas vezes para o mesmo cliente
  CONSTRAINT uq_ap_news_url_cliente UNIQUE (url_original, cliente_id)
);

-- Índices compostos gerais
CREATE INDEX idx_ap_news_cliente_status ON ap.candidate_news(cliente_id, status);
CREATE INDEX idx_ap_news_agendado ON ap.candidate_news(horario_agendado)
  WHERE status = 'queued_for_posting';

-- Índices PARCIAIS por status (worker-specific, evita full scans com tabela grande)
CREATE INDEX idx_ap_news_raw      ON ap.candidate_news(cliente_id, created_at)  WHERE status = 'raw';
CREATE INDEX idx_ap_news_ready    ON ap.candidate_news(cliente_id)               WHERE status = 'ready_for_scoring';
CREATE INDEX idx_ap_news_selected ON ap.candidate_news(cliente_id)               WHERE status = 'selected';
CREATE INDEX idx_ap_news_render   ON ap.candidate_news(cliente_id)               WHERE status = 'pending_render';

-- Índice dedicado para o Publisher (consulta horario_agendado frequentemente)
CREATE INDEX idx_ap_scheduler_lookup
  ON ap.candidate_news(cliente_id, horario_agendado)
  WHERE status = 'queued_for_posting';

-- Índice para self-healing: detectar registros presos (processing_started_at antigo)
CREATE INDEX idx_ap_news_stuck
  ON ap.candidate_news(processing_started_at)
  WHERE processing_started_at IS NOT NULL;
