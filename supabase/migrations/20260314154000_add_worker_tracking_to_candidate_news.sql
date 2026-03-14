-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- AutoPublisher — Add Worker Tracking to candidate_news
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Adiciona worker_id para rastreamento de concorrência em ambiente distribuído
ALTER TABLE ap.candidate_news ADD COLUMN IF NOT EXISTS worker_id UUID;

-- Garante que retry_count existe (já existe, mas por segurança)
-- ALTER TABLE ap.candidate_news ADD COLUMN IF NOT EXISTS retry_count INT DEFAULT 0;

COMMENT ON COLUMN ap.candidate_news.worker_id IS 'ID do worker que assumiu o processamento desta matéria.';
