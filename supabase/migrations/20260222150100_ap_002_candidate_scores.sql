CREATE TABLE IF NOT EXISTS ap.candidate_scores (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  news_id         UUID NOT NULL REFERENCES ap.candidate_news(id) ON DELETE CASCADE,
  cliente_id      UUID NOT NULL,
  base_score      FLOAT DEFAULT 0,
  semantic_score  FLOAT DEFAULT 0,
  learning_score  FLOAT DEFAULT 0,
  score_total     FLOAT GENERATED ALWAYS AS (base_score + semantic_score + learning_score) STORED,
  scored_at       TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_ap_scores_news UNIQUE (news_id)
);

CREATE INDEX idx_ap_scores_cliente_total ON ap.candidate_scores(cliente_id, score_total DESC);
