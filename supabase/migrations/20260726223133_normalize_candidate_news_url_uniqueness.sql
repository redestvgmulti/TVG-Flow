-- candidate_news.url_original is NOT NULL. Manual submissions legitimately have
-- no Link Origem, so blank values remain '' and must be excluded from URL
-- de-duplication. This also removes the legacy total unique constraint that
-- production still has under uq_candidate_news_url_cliente.

DO $migration$
DECLARE
  duplicate_count integer;
BEGIN
  SELECT count(*)
  INTO duplicate_count
  FROM (
    SELECT cliente_id, btrim(url_original) AS url_original
    FROM ap.candidate_news
    WHERE btrim(url_original) <> ''
      AND status NOT IN ('rejected', 'posted', 'failed')
    GROUP BY cliente_id, btrim(url_original)
    HAVING count(*) > 1
  ) duplicates;

  IF duplicate_count > 0 THEN
    RAISE EXCEPTION
      'CANDIDATE_NEWS_URL_DUPLICATES count=%',
      duplicate_count
      USING ERRCODE = '23505',
            HINT = 'Reconcile duplicate active source URLs before applying this migration.';
  END IF;
END;
$migration$;

UPDATE ap.candidate_news
SET url_original = ''
WHERE btrim(url_original) = ''
  AND url_original <> '';

ALTER TABLE ap.candidate_news
  DROP CONSTRAINT IF EXISTS uq_candidate_news_url_cliente;
ALTER TABLE ap.candidate_news
  DROP CONSTRAINT IF EXISTS uq_ap_news_url_cliente;

DROP INDEX IF EXISTS ap.uq_candidate_news_url_cliente;
DROP INDEX IF EXISTS ap.uq_ap_news_url_cliente;
DROP INDEX IF EXISTS ap.uq_candidate_news_client_url_active;

CREATE UNIQUE INDEX uq_candidate_news_client_url_active
  ON ap.candidate_news (cliente_id, url_original)
  WHERE url_original <> ''
    AND status NOT IN ('rejected', 'posted', 'failed');

CREATE OR REPLACE FUNCTION ap.normalize_candidate_news_url_original()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $function$
BEGIN
  NEW.url_original := COALESCE(NULLIF(btrim(NEW.url_original), ''), '');
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_candidate_news_normalize_url_original
  ON ap.candidate_news;

CREATE TRIGGER trg_candidate_news_normalize_url_original
  BEFORE INSERT OR UPDATE OF url_original ON ap.candidate_news
  FOR EACH ROW
  EXECUTE FUNCTION ap.normalize_candidate_news_url_original();
