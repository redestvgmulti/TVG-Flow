-- Canonical editorial uploads are append-only and scoped to both the
-- operational client and the authenticated author. The frontend obtains the
-- client id from public.require_single_operational_cliente_id(); this policy
-- remains the authority and rejects forged tenant/user path segments.

DROP POLICY IF EXISTS ap_images_authenticated_insert_editorial_uploads
    ON storage.objects;

CREATE POLICY ap_images_authenticated_insert_editorial_uploads
    ON storage.objects
    FOR INSERT
    TO authenticated
    WITH CHECK (
        bucket_id = 'ap-images'
        AND (storage.foldername(name))[1] = 'editorial_uploads'
        AND (storage.foldername(name))[2] IN (
            SELECT ap.get_user_cliente_ids()::text
        )
        AND (storage.foldername(name))[3] = auth.uid()::text
        AND name ~ '^editorial_uploads/[0-9a-fA-F-]{36}/[0-9a-fA-F-]{36}/[0-9a-fA-F-]{36}[.](png|jpg|webp)$'
    );

COMMENT ON POLICY ap_images_authenticated_insert_editorial_uploads
    ON storage.objects IS
    'Insert-only canonical editorial source images scoped by client and authenticated author.';
