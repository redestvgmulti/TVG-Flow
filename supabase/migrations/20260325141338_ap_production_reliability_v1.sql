-- 1. Sync status column with the requested state machine
DO $$ 
BEGIN
    ALTER TABLE ap.candidate_news DROP CONSTRAINT IF EXISTS candidate_news_status_check;
    ALTER TABLE ap.candidate_news ADD CONSTRAINT candidate_news_status_check 
    CHECK (status = ANY (ARRAY[
        'raw', 
        'ready_for_scoring', 
        'scored', 
        'selected', 
        'pending_production', 
        'pending_render', 
        'pending_review', 
        'approved', 
        'queued_for_posting', 
        'posted', 
        'rejected', 
        'processing', 
        'failed'
    ]));
END $$;

-- 2. Add LLM specific attempts tracking if not exists
ALTER TABLE ap.candidate_news ADD COLUMN IF NOT EXISTS llm_attempts INTEGER DEFAULT 0;

-- 3. Add necessary indexes for starvation prevention and fast lock acquisition
CREATE INDEX IF NOT EXISTS idx_ap_news_lock_render ON ap.candidate_news (status, render_url, render_started_at) WHERE render_url IS NULL;
CREATE INDEX IF NOT EXISTS idx_ap_news_lock_processing ON ap.candidate_news (status, processing_started_at);
CREATE INDEX IF NOT EXISTS idx_ap_news_created_at ON ap.candidate_news (created_at ASC);
;
