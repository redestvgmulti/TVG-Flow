BEGIN;

ALTER TABLE ap.sources DROP CONSTRAINT IF EXISTS sources_tipo_check;
ALTER TABLE ap.sources
    ADD CONSTRAINT sources_tipo_check
    CHECK (tipo IN ('auto', 'website', 'rss', 'atom', 'google_news_rss', 'sitemap', 'instagram'));

ALTER TABLE ap.sources DROP CONSTRAINT IF EXISTS sources_detected_type_check;
ALTER TABLE ap.sources
    ADD CONSTRAINT sources_detected_type_check
    CHECK (detected_type IS NULL OR detected_type IN ('website', 'rss', 'atom', 'google_news_rss', 'sitemap', 'instagram'));

NOTIFY pgrst, 'reload schema';
COMMIT;
