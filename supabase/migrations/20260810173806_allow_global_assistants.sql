-- Global assistants are intentionally available even when the creator has no
-- tenant membership. Tenant-bound assistants retain the existing isolation.
ALTER TABLE public.assistentes
    ALTER COLUMN tenant_id DROP NOT NULL;

DROP POLICY IF EXISTS assistentes_select_scoped ON public.assistentes;
CREATE POLICY assistentes_select_scoped ON public.assistentes FOR SELECT TO authenticated USING (
    assistentes.tenant_id IS NULL
    OR public.is_super_admin()
    OR (public.is_admin_safe() AND public.is_admin_of_tenant(assistentes.tenant_id))
    OR EXISTS (
        SELECT 1
        FROM public.empresa_profissionais ep
        JOIN public.empresas e ON e.id = ep.empresa_id
        WHERE ep.profissional_id = auth.uid()
          AND ep.ativo = true
          AND e.empresa_tipo = 'operacional'
          AND e.tenant_id = assistentes.tenant_id
    )
);

DROP POLICY IF EXISTS assistentes_manage_scoped ON public.assistentes;
CREATE POLICY assistentes_manage_scoped ON public.assistentes FOR ALL TO authenticated USING (
    public.is_super_admin()
    OR (public.is_admin_safe() AND (
        assistentes.tenant_id IS NULL
        OR public.is_admin_of_tenant(assistentes.tenant_id)
    ))
) WITH CHECK (
    public.is_super_admin()
    OR (public.is_admin_safe() AND (
        assistentes.tenant_id IS NULL
        OR public.is_admin_of_tenant(assistentes.tenant_id)
    ))
);

DROP POLICY IF EXISTS assistant_images_admin_insert ON storage.objects;
CREATE POLICY assistant_images_admin_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK (
    bucket_id = 'assistant-images'
    AND (
        public.is_super_admin()
        OR (public.is_admin_safe() AND CASE
            WHEN (storage.foldername(name))[1] = 'global' THEN true
            WHEN (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN public.is_admin_of_tenant(((storage.foldername(name))[1])::uuid)
            ELSE false
        END)
    )
);

DROP POLICY IF EXISTS assistant_images_admin_update ON storage.objects;
CREATE POLICY assistant_images_admin_update ON storage.objects FOR UPDATE TO authenticated USING (
    bucket_id = 'assistant-images'
    AND (
        public.is_super_admin()
        OR (public.is_admin_safe() AND CASE
            WHEN (storage.foldername(name))[1] = 'global' THEN true
            WHEN (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN public.is_admin_of_tenant(((storage.foldername(name))[1])::uuid)
            ELSE false
        END)
    )
) WITH CHECK (
    bucket_id = 'assistant-images'
    AND (
        public.is_super_admin()
        OR (public.is_admin_safe() AND CASE
            WHEN (storage.foldername(name))[1] = 'global' THEN true
            WHEN (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN public.is_admin_of_tenant(((storage.foldername(name))[1])::uuid)
            ELSE false
        END)
    )
);

DROP POLICY IF EXISTS assistant_images_admin_delete ON storage.objects;
CREATE POLICY assistant_images_admin_delete ON storage.objects FOR DELETE TO authenticated USING (
    bucket_id = 'assistant-images'
    AND (
        public.is_super_admin()
        OR (public.is_admin_safe() AND CASE
            WHEN (storage.foldername(name))[1] = 'global' THEN true
            WHEN (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN public.is_admin_of_tenant(((storage.foldername(name))[1])::uuid)
            ELSE false
        END)
    )
);
