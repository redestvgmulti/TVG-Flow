
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- Fix 1: Schedule ap-render-recovery to run every 30 minutes via pg_cron
-- This ensures items stuck in 'failed' state are automatically retried.
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SELECT cron.schedule(
  'ap-render-recovery',
  '*/30 * * * *',
  $$
  SELECT net.http_post(
    url := current_setting('app.supabase_url') || '/functions/v1/ap-render-recovery',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- Fix 2: Add uniqueness constraint on (cliente_id, titulo) to prevent
-- duplicate news entries from polluting the pipeline.
-- Uses a partial index scoped to non-rejected/non-failed items only.
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CREATE UNIQUE INDEX IF NOT EXISTS uq_candidate_news_client_title_active
  ON ap.candidate_news (cliente_id, titulo)
  WHERE status NOT IN ('rejected', 'posted', 'failed');

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- Fix 3: Also add url_original uniqueness for RSS-sourced items
-- to prevent the same article from being re-ingested after 24h window reset.
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CREATE UNIQUE INDEX IF NOT EXISTS uq_candidate_news_client_url_active
  ON ap.candidate_news (cliente_id, url_original)
  WHERE url_original IS NOT NULL
    AND status NOT IN ('rejected', 'posted', 'failed');
;
