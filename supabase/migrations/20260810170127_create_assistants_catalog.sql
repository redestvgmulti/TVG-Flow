-- Tenant-scoped GPT assistant catalog. A card requires only image, name and GPT URL.
CREATE TABLE IF NOT EXISTS public.assistentes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
    nome text NOT NULL CHECK (char_length(btrim(nome)) BETWEEN 1 AND 120),
    imagem_path text NOT NULL,
    gpt_url text NOT NULL CHECK (gpt_url ~ '^https://(chatgpt\\.com|chat\\.openai\\.com)/g/'),
    ativo boolean NOT NULL DEFAULT true,
    ordem integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
    updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS assistentes_tenant_ativo_ordem_idx
    ON public.assistentes (tenant_id, ativo, ordem, nome);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.assistentes TO authenticated;
ALTER TABLE public.assistentes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS assistentes_select_scoped ON public.assistentes;
CREATE POLICY assistentes_select_scoped ON public.assistentes FOR SELECT TO authenticated USING (
    public.is_super_admin()
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
    OR (public.is_admin_safe() AND public.is_admin_of_tenant(assistentes.tenant_id))
) WITH CHECK (
    public.is_super_admin()
    OR (public.is_admin_safe() AND public.is_admin_of_tenant(assistentes.tenant_id))
);

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('assistant-images', 'assistant-images', true, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS assistant_images_admin_insert ON storage.objects;
CREATE POLICY assistant_images_admin_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK (
    bucket_id = 'assistant-images'
    AND public.is_admin_safe()
    AND public.is_admin_of_tenant(((storage.foldername(name))[1])::uuid)
);

DROP POLICY IF EXISTS assistant_images_admin_update ON storage.objects;
CREATE POLICY assistant_images_admin_update ON storage.objects FOR UPDATE TO authenticated USING (
    bucket_id = 'assistant-images'
    AND public.is_admin_safe()
    AND public.is_admin_of_tenant(((storage.foldername(name))[1])::uuid)
) WITH CHECK (
    bucket_id = 'assistant-images'
    AND public.is_admin_safe()
    AND public.is_admin_of_tenant(((storage.foldername(name))[1])::uuid)
);

DROP POLICY IF EXISTS assistant_images_admin_delete ON storage.objects;
CREATE POLICY assistant_images_admin_delete ON storage.objects FOR DELETE TO authenticated USING (
    bucket_id = 'assistant-images'
    AND public.is_admin_safe()
    AND public.is_admin_of_tenant(((storage.foldername(name))[1])::uuid)
);
