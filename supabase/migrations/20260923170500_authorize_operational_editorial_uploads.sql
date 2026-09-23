-- Staff may work for an operational client through an active tenant-company
-- membership. Use the same fail-closed client set as the upload path resolver.
-- Keep uploads append-only and bound to the authenticated author.
BEGIN;

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
            SELECT ap.get_operational_cliente_ids()::text
        )
        AND (storage.foldername(name))[3] = auth.uid()::text
        AND name ~ '^editorial_uploads/[0-9a-fA-F-]{36}/[0-9a-fA-F-]{36}/[0-9a-fA-F-]{36}[.](png|jpg|webp)$'
    );

COMMENT ON POLICY ap_images_authenticated_insert_editorial_uploads
    ON storage.objects IS
    'Append-only editorial source images scoped to an operational client and the authenticated author.';

COMMIT;
