-- The AutoPublisher runtime writes two candidate_news statuses that the base
-- schema check constraint never allowed:
--   * 'processing' — set on creation by ap.create_candidate_with_sponsors_core_v1
--     and by ap-employee-generator while the LLM copy is produced, and used as
--     the claim predicate for the global generation queue.
--   * 'failed' — the terminal state written by ap-render-engine,
--     ap-render-recovery and ap-content-production when their retry caps are hit.
-- Neither value is present in candidate_news_status_check, so every candidate
-- creation and every exhausted-retry error handler aborts with a check
-- violation. Widen the constraint to match the vocabulary the code has used
-- since the employee-mode global queue shipped.

ALTER TABLE ap.candidate_news
    DROP CONSTRAINT IF EXISTS candidate_news_status_check;

ALTER TABLE ap.candidate_news
    ADD CONSTRAINT candidate_news_status_check
    CHECK (status = ANY (ARRAY[
        'raw',
        'processing',
        'ready_for_scoring',
        'scored',
        'selected',
        'pending_render',
        'pending_review',
        'approved',
        'queued_for_posting',
        'posted',
        'rejected',
        'failed'
    ]::text[]));
