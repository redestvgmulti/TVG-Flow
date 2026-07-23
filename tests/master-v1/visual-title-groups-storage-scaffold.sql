\set ON_ERROR_STOP on

CREATE SCHEMA IF NOT EXISTS storage;

CREATE TABLE IF NOT EXISTS storage.objects (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    bucket_id text NOT NULL,
    name text NOT NULL,
    owner uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (bucket_id, name)
);

CREATE OR REPLACE FUNCTION storage.foldername(p_name text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE
        WHEN position('/' IN p_name) = 0 THEN ARRAY[]::text[]
        ELSE string_to_array(regexp_replace(p_name, '/[^/]+$', ''), '/')
    END;
$$;

ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

GRANT USAGE ON SCHEMA storage TO authenticated, anon, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated;
GRANT SELECT ON storage.objects TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO service_role;

DROP POLICY IF EXISTS "Give public access to ap-images" ON storage.objects;
DROP POLICY IF EXISTS "Give auth insert access to ap-images" ON storage.objects;
DROP POLICY IF EXISTS "Give auth update access to ap-images" ON storage.objects;
DROP POLICY IF EXISTS "Give auth delete access to ap-images" ON storage.objects;

CREATE POLICY "Give public access to ap-images"
    ON storage.objects
    FOR SELECT
    TO public
    USING (bucket_id = 'ap-images');

CREATE POLICY "Give auth insert access to ap-images"
    ON storage.objects
    FOR INSERT
    TO authenticated
    WITH CHECK (bucket_id = 'ap-images');

CREATE POLICY "Give auth update access to ap-images"
    ON storage.objects
    FOR UPDATE
    TO authenticated
    USING (bucket_id = 'ap-images')
    WITH CHECK (bucket_id = 'ap-images');

CREATE POLICY "Give auth delete access to ap-images"
    ON storage.objects
    FOR DELETE
    TO authenticated
    USING (bucket_id = 'ap-images');
