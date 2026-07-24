-- uq_ap_news_url_cliente (base schema 20260223031956) is a total unique index on
-- (url_original, cliente_id). Manual/employee candidates carry no source URL and
-- are persisted with url_original = '' (the column is NOT NULL), so a client
-- could only ever hold a single URL-less candidate before the second collided --
-- which breaks ap.create_candidate_with_sponsors and the manual ap-employee
-- generator path. URL-level deduplication is only meaningful for real ingested
-- URLs (manual duplicates are already guarded in the edge function by title +
-- content within 24h), so restrict the uniqueness to non-empty URLs.

ALTER TABLE ap.candidate_news
    DROP CONSTRAINT IF EXISTS uq_ap_news_url_cliente;

DROP INDEX IF EXISTS ap.uq_ap_news_url_cliente;

CREATE UNIQUE INDEX IF NOT EXISTS uq_ap_news_url_cliente
    ON ap.candidate_news (url_original, cliente_id)
    WHERE url_original <> '';
