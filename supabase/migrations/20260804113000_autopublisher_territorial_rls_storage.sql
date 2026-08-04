-- Tenant isolation, least-privilege grants and immutable Storage prefixes for
-- territorial administration. Existing visual-title/sponsor policies remain
-- unchanged.

ALTER TABLE ap.territorial_regions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ap.territorial_cities ENABLE ROW LEVEL SECURITY;
ALTER TABLE ap.territorial_region_sponsors ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
    ap.territorial_regions,
    ap.territorial_cities,
    ap.territorial_region_sponsors
FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT ON TABLE
    ap.territorial_regions,
    ap.territorial_cities,
    ap.territorial_region_sponsors
TO authenticated, service_role;

CREATE POLICY territorial_regions_select_own_client
    ON ap.territorial_regions
    FOR SELECT
    TO authenticated
    USING (
        cliente_id IN (SELECT ap.get_user_cliente_ids())
    );

CREATE POLICY territorial_cities_select_own_client
    ON ap.territorial_cities
    FOR SELECT
    TO authenticated
    USING (
        cliente_id IN (SELECT ap.get_user_cliente_ids())
    );

CREATE POLICY territorial_region_sponsors_select_own_client
    ON ap.territorial_region_sponsors
    FOR SELECT
    TO authenticated
    USING (
        cliente_id IN (SELECT ap.get_user_cliente_ids())
    );

-- New policies are separate from the live visual-titles/sponsors policy, so
-- their current behavior is not rewritten. PostgreSQL combines permissive
-- INSERT policies with OR semantics.
CREATE POLICY ap_images_authenticated_insert_regions
    ON storage.objects
    FOR INSERT
    TO authenticated
    WITH CHECK (
        bucket_id = 'ap-images'
        AND (storage.foldername(name))[1] = 'regions'
        AND (storage.foldername(name))[2] IN (
            SELECT ap.get_user_cliente_ids()::text
        )
        AND name ~ (
            '^regions/'
            || (storage.foldername(name))[2]
            || '/[a-z0-9][a-z0-9_-]*/[0-9a-f]{64}[.]png$'
        )
    );

CREATE POLICY ap_images_authenticated_insert_cities
    ON storage.objects
    FOR INSERT
    TO authenticated
    WITH CHECK (
        bucket_id = 'ap-images'
        AND (storage.foldername(name))[1] = 'cities'
        AND (storage.foldername(name))[2] IN (
            SELECT ap.get_user_cliente_ids()::text
        )
        AND name ~ (
            '^cities/'
            || (storage.foldername(name))[2]
            || '/[a-z0-9][a-z0-9_-]*/[0-9a-f]{64}[.]png$'
        )
    );

-- There are intentionally no UPDATE or DELETE policies for regions/cities:
-- every replacement is a new content-addressed object.
REVOKE ALL ON FUNCTION ap.normalize_territorial_name(text)
FROM PUBLIC, anon;
