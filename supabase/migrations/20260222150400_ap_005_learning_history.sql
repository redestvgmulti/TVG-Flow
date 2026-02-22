CREATE TABLE IF NOT EXISTS ap.learning_history (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id      UUID NOT NULL,
  news_id         UUID REFERENCES ap.candidate_news(id) ON DELETE SET NULL,
  categoria       TEXT,
  fonte_id        UUID,
  acao            TEXT CHECK (acao IN ('approved','rejected','edited')),
  score_delta     FLOAT DEFAULT 0,
  registrado_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ap_learning_lookup ON ap.learning_history(cliente_id, registrado_at DESC);
