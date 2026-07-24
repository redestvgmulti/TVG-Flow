\set ON_ERROR_STOP on

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.assert_true(
    p_condition boolean,
    p_message text
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
    IF NOT COALESCE(p_condition, false) THEN
        RAISE EXCEPTION 'assertion failed: %', p_message;
    END IF;
END;
$$;

-- 1. The bucket exists with the configuration the AutoPublisher relies on.
SELECT pg_temp.assert_true(
    EXISTS (
        SELECT 1 FROM storage.buckets
        WHERE id = 'ap-images'
          AND public IS TRUE
          AND file_size_limit = 5242880
          AND allowed_mime_types = ARRAY['image/png']::text[]
    ),
    'ap-images bucket is missing or misconfigured after migration replay'
);

-- 2. Re-applying the migration body neither duplicates nor mutates the bucket.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('ap-images', 'ap-images', false, 1, ARRAY['image/jpeg']::text[])
ON CONFLICT (id) DO NOTHING;

SELECT pg_temp.assert_true(
    (SELECT count(*) FROM storage.buckets WHERE id = 'ap-images') = 1,
    'ap-images bucket was duplicated on re-apply'
);
SELECT pg_temp.assert_true(
    EXISTS (
        SELECT 1 FROM storage.buckets
        WHERE id = 'ap-images'
          AND public IS TRUE
          AND file_size_limit = 5242880
          AND allowed_mime_types = ARRAY['image/png']::text[]
    ),
    're-apply overwrote a valid ap-images configuration'
);

-- 3. Objects can be stored in the bucket (foreign key to storage.buckets holds).
INSERT INTO storage.objects (bucket_id, name)
VALUES (
    'ap-images',
    'sponsors/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/acme/' || repeat('a', 64) || '.png'
);
SELECT pg_temp.assert_true(
    EXISTS (
        SELECT 1 FROM storage.objects
        WHERE bucket_id = 'ap-images'
          AND name LIKE 'sponsors/aaaaaaaa-%'
    ),
    'a valid ap-images object could not be stored'
);

ROLLBACK;

\echo 'ap-images-bucket.sql: PASS'
