-- 2B.1 / Migration 1: editorial origin + production intent fields.
-- Purely additive on ap.editorial_articles. Does not touch ap.candidate_news,
-- ap.render_generations, ap_private, or any P0 object.
BEGIN;

-- A direct origin (link/text/image submitted without an adopted backlog
-- item) must not require a news_backlog row. The composite FK
-- editorial_articles_backlog_tenant_fkey already tolerates NULL (Postgres
-- MATCH SIMPLE skips the check when any referencing column is NULL), and a
-- nullable UNIQUE column already allows multiple NULLs.
ALTER TABLE ap.editorial_articles
    ALTER COLUMN news_backlog_id DROP NOT NULL;

ALTER TABLE ap.editorial_articles
    ADD COLUMN origin_type text NOT NULL DEFAULT 'news_backlog',
    ADD COLUMN origin_reference text,
    ADD COLUMN production_input_type text NOT NULL DEFAULT 'link',
    ADD COLUMN content_type text,
    ADD COLUMN visual_model text,
    ADD COLUMN visual_title_id uuid,
    ADD COLUMN region_id uuid,
    ADD COLUMN city_id uuid,
    ADD COLUMN manual_slots jsonb,
    ADD COLUMN source_image_url text,
    ADD COLUMN editorial_region_id uuid,
    ADD COLUMN reviewed_by_user_id uuid
        REFERENCES public.profissionais(id) ON DELETE RESTRICT,
    ADD COLUMN reviewed_by_name_snapshot text,
    ADD COLUMN ready_for_render_at timestamptz,
    ADD COLUMN dispatched_at timestamptz,
    ADD COLUMN candidate_news_id uuid
        REFERENCES ap.candidate_news(id) ON DELETE RESTRICT;

-- Multiple NULLs are allowed (most articles never reach dispatch), but once
-- set, a candidate can never be claimed by a second article.
ALTER TABLE ap.editorial_articles
    ADD CONSTRAINT editorial_articles_candidate_news_id_key UNIQUE (candidate_news_id);

ALTER TABLE ap.editorial_articles
    ADD CONSTRAINT editorial_articles_origin_type_check
        CHECK (origin_type IN ('news_backlog', 'link', 'text', 'image')),
    ADD CONSTRAINT editorial_articles_production_input_type_check
        CHECK (production_input_type IN ('link', 'text', 'image')),
    ADD CONSTRAINT editorial_articles_content_type_check
        CHECK (content_type IS NULL OR content_type IN ('feed', 'reels', 'story')),
    -- A backlog-originated article always carries its backlog row; a direct
    -- origin (link/text/image) never does. Prevents the two domains from
    -- silently drifting apart.
    ADD CONSTRAINT editorial_articles_origin_backlog_consistency_check
        CHECK ((origin_type = 'news_backlog') = (news_backlog_id IS NOT NULL)),
    -- image/link origins are captured as a reference URL; text has none.
    ADD CONSTRAINT editorial_articles_origin_reference_shape_check
        CHECK (
            (origin_type IN ('link', 'image') AND origin_reference IS NOT NULL AND origin_reference ~ '^https?://')
            OR (origin_type = 'text' AND origin_reference IS NULL)
            OR (origin_type = 'news_backlog' AND origin_reference IS NULL)
        );

COMMENT ON COLUMN ap.editorial_articles.origin_type IS
    '2B.1: where the article started. Radar provenance is not duplicated here — it is a fact of ap.news_backlog.collected_news_id, joinable when origin_type = news_backlog.';
COMMENT ON COLUMN ap.editorial_articles.production_input_type IS
    '2B.1: how the operator is currently producing the content. Mutable independently of origin_type, which never changes once set.';
COMMENT ON COLUMN ap.editorial_articles.editorial_region_id IS
    '2B.1: foundation column for future regional governance. Not read or written by any RPC in this migration set.';
COMMENT ON COLUMN ap.editorial_articles.candidate_news_id IS
    '2B.1: set once by ap.attach_editorial_article_candidate. Never updated afterward.';

COMMIT;
