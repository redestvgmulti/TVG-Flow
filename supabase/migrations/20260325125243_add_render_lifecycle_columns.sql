
-- ═══════════════════════════════════════════════════════════════════
-- MIGRATION: Add render lifecycle columns for idempotent CAS locking
-- AutoPublisher — Fix duplicate image generation
-- ═══════════════════════════════════════════════════════════════════

-- 1. Add lifecycle columns to candidate_news
ALTER TABLE ap.candidate_news
    ADD COLUMN IF NOT EXISTS render_started_at    TIMESTAMPTZ DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS render_completed_at  TIMESTAMPTZ DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS render_attempts      INT         NOT NULL DEFAULT 0;

-- 2. Performance index for worker polling
CREATE INDEX IF NOT EXISTS idx_candidate_news_render_eligible
    ON ap.candidate_news (status, render_started_at)
    WHERE status = 'pending_render';

-- 3. Reset any stuck render_started_at from old runs (safety net)
UPDATE ap.candidate_news
SET render_started_at = NULL
WHERE status = 'pending_render'
  AND render_started_at IS NOT NULL
  AND render_started_at < NOW() - INTERVAL '30 minutes';

COMMENT ON COLUMN ap.candidate_news.render_started_at
    IS 'CAS lock timestamp. Set atomically by ap-render-engine before calling Placid. Items with this set are considered in-flight.';
COMMENT ON COLUMN ap.candidate_news.render_completed_at
    IS 'Timestamp when Placid render was successfully persisted.';
COMMENT ON COLUMN ap.candidate_news.render_attempts
    IS 'Number of render attempts made. Used by recovery worker to cap retries.';
;
