-- Normalize only reviewable items collected by the official Meta Instagram Radar.
-- Raw Meta captions remain in content; canonical URLs, hashes and provenance remain unchanged.
WITH eligible AS (
  SELECT
    id,
    metadata,
    regexp_replace(
      regexp_replace(
        split_part(COALESCE(content, ''), E'\n', 1),
        '(^|[[:space:]])#[[:alnum:]_]+',
        ' ',
        'g'
      ),
      '[[:space:]]+',
      ' ',
      'g'
    ) AS first_line,
    regexp_replace(
      regexp_replace(COALESCE(content, ''), '(^|[[:space:]])#[[:alnum:]_]+', ' ', 'g'),
      '[[:space:]]+',
      ' ',
      'g'
    ) AS cleaned_content
  FROM ap.collected_news
  WHERE status = 'pending_review'
    AND metadata ->> 'platform' = 'instagram'
    AND metadata ->> 'provider' = 'meta_business_discovery'
), normalized AS (
  SELECT
    id,
    CASE
      WHEN length(btrim(COALESCE((regexp_match(first_line, '^(.{3,180}?[.!?…])(?=[[:space:]]|$|[^[:alnum:]])'))[1], left(first_line, 180)))) >= 3
        THEN btrim(COALESCE((regexp_match(first_line, '^(.{3,180}?[.!?…])(?=[[:space:]]|$|[^[:alnum:]])'))[1], left(first_line, 180)))
      ELSE 'Publicação de @' || COALESCE(NULLIF(metadata ->> 'source_username', ''), 'instagram')
    END AS title,
    NULLIF(left(btrim(cleaned_content), 500), '') AS excerpt
  FROM eligible
)
UPDATE ap.collected_news AS collected
SET
  title = normalized.title,
  excerpt = normalized.excerpt,
  updated_at = now()
FROM normalized
WHERE collected.id = normalized.id;
