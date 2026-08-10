-- Catalog access is shared, but only administrators can mutate catalog data.
DROP POLICY IF EXISTS assistentes_manage_scoped ON public.assistentes;
CREATE POLICY assistentes_manage_scoped ON public.assistentes
FOR ALL TO authenticated
USING (
    public.is_super_admin()
    OR (
        public.is_admin_safe()
        AND (
            assistentes.tenant_id IS NULL
            OR public.is_admin_of_tenant(assistentes.tenant_id)
        )
    )
)
WITH CHECK (
    public.is_super_admin()
    OR (
        public.is_admin_safe()
        AND (
            assistentes.tenant_id IS NULL
            OR public.is_admin_of_tenant(assistentes.tenant_id)
        )
    )
);

-- The public bucket serves the catalog images; writing remains admin-only.
DROP POLICY IF EXISTS assistant_images_admin_insert ON storage.objects;
CREATE POLICY assistant_images_admin_insert ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
    bucket_id = 'assistant-images'
    AND (
        public.is_super_admin()
        OR (
            public.is_admin_safe()
            AND (
                (storage.foldername(name))[1] = 'global'
                OR (
                    (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                    AND public.is_admin_of_tenant(((storage.foldername(name))[1])::uuid)
                )
            )
        )
    )
);

DROP POLICY IF EXISTS assistant_images_admin_update ON storage.objects;
CREATE POLICY assistant_images_admin_update ON storage.objects
FOR UPDATE TO authenticated
USING (
    bucket_id = 'assistant-images'
    AND (
        public.is_super_admin()
        OR (
            public.is_admin_safe()
            AND (
                (storage.foldername(name))[1] = 'global'
                OR ((storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' AND public.is_admin_of_tenant(((storage.foldername(name))[1])::uuid))
            )
        )
    )
)
WITH CHECK (
    bucket_id = 'assistant-images'
    AND (
        public.is_super_admin()
        OR (
            public.is_admin_safe()
            AND (
                (storage.foldername(name))[1] = 'global'
                OR ((storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' AND public.is_admin_of_tenant(((storage.foldername(name))[1])::uuid))
            )
        )
    )
);

DROP POLICY IF EXISTS assistant_images_admin_delete ON storage.objects;
CREATE POLICY assistant_images_admin_delete ON storage.objects
FOR DELETE TO authenticated
USING (
    bucket_id = 'assistant-images'
    AND (
        public.is_super_admin()
        OR (
            public.is_admin_safe()
            AND (
                (storage.foldername(name))[1] = 'global'
                OR ((storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' AND public.is_admin_of_tenant(((storage.foldername(name))[1])::uuid))
            )
        )
    )
);
