-- 1. Update content_type check constraint in ap.candidate_news
ALTER TABLE ap.candidate_news DROP CONSTRAINT IF EXISTS candidate_news_content_type_check;
ALTER TABLE ap.candidate_news ADD CONSTRAINT candidate_news_content_type_check 
  CHECK (content_type = ANY (ARRAY['feed'::text, 'reels'::text, 'carousel'::text, 'sponsored'::text]));

-- 2. Update status check constraint if missing any states
-- Already verified in list_tables, but just for safety:
ALTER TABLE ap.candidate_news DROP CONSTRAINT IF EXISTS candidate_news_status_check;
ALTER TABLE ap.candidate_news ADD CONSTRAINT candidate_news_status_check
  CHECK (status = ANY (ARRAY['raw'::text, 'ready_for_scoring'::text, 'scored'::text, 'selected'::text, 'pending_production'::text, 'pending_render'::text, 'pending_review'::text, 'approved'::text, 'queued_for_posting'::text, 'posted'::text, 'rejected'::text, 'processing'::text, 'failed'::text, 'studio_selected'::text, 'studio_ready'::text]));

-- 3. Update ap.templates content_type constraint
ALTER TABLE ap.templates DROP CONSTRAINT IF EXISTS templates_tipo_check;
ALTER TABLE ap.templates ADD CONSTRAINT templates_tipo_check
  CHECK (tipo = ANY (ARRAY['feed'::text, 'reels'::text, 'carousel'::text, 'sponsored'::text]));
;
