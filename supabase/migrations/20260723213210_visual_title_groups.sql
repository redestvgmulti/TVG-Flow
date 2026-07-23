-- Sprint G1: organize visual titles without changing their render contract.
-- The group is tenant-scoped metadata. Existing assets and visual_title_id values
-- remain unchanged, and group_id intentionally stays nullable during rollout.

CREATE TABLE IF NOT EXISTS ap.visual_title_groups (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cliente_id uuid NOT NULL REFERENCES public.clientes(id) ON DELETE RESTRICT,
    nome text NOT NULL,
    slug text NOT NULL,
    descricao text,
    ordem integer NOT NULL DEFAULT 0,
    ativo boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT visual_title_groups_cliente_slug_key UNIQUE (cliente_id, slug),
    CONSTRAINT visual_title_groups_cliente_id_key UNIQUE (cliente_id, id),
    CONSTRAINT visual_title_groups_nome_nonempty CHECK (length(btrim(nome)) > 0),
    CONSTRAINT visual_title_groups_slug_nonempty CHECK (length(btrim(slug)) > 0),
    CONSTRAINT visual_title_groups_slug_lowercase CHECK (slug = lower(slug)),
    CONSTRAINT visual_title_groups_ordem_nonnegative CHECK (ordem >= 0)
);

-- This partial index is the normal administrative-list and RLS access path. The
-- unique (cliente_id, slug) index remains available for unfiltered lookups.
CREATE INDEX IF NOT EXISTS idx_visual_title_groups_cliente_active_ordem
    ON ap.visual_title_groups (cliente_id, ordem, nome)
    WHERE ativo;

ALTER TABLE ap.visual_titles
    ADD COLUMN IF NOT EXISTS group_id uuid;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'visual_titles_cliente_group_fkey'
          AND conrelid = 'ap.visual_titles'::regclass
    ) THEN
        ALTER TABLE ap.visual_titles
            ADD CONSTRAINT visual_titles_cliente_group_fkey
            FOREIGN KEY (cliente_id, group_id)
            REFERENCES ap.visual_title_groups (cliente_id, id)
            ON DELETE RESTRICT;
    END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_visual_titles_cliente_group_active_ordem
    ON ap.visual_titles (cliente_id, group_id, ordem, nome)
    WHERE ativo;

-- Backfill each affected tenant into an ordinary, editable "Geral" group. The
-- deterministic fallback slug avoids conflicts without moving Storage assets or
-- changing any visual_title identifier.
DO $$
DECLARE
    v_cliente_id uuid;
    v_group_id uuid;
    v_slug text;
    v_suffix integer;
BEGIN
    FOR v_cliente_id IN
        SELECT DISTINCT cliente_id
        FROM ap.visual_titles
        WHERE group_id IS NULL
    LOOP
        SELECT id
        INTO v_group_id
        FROM ap.visual_title_groups
        WHERE cliente_id = v_cliente_id
          AND nome = 'Geral'
        ORDER BY CASE WHEN slug = 'geral' THEN 0 ELSE 1 END, slug
        LIMIT 1;

        IF v_group_id IS NULL THEN
            v_slug := 'geral';
            v_suffix := 0;

            WHILE EXISTS (
                SELECT 1
                FROM ap.visual_title_groups
                WHERE cliente_id = v_cliente_id
                  AND slug = v_slug
            ) LOOP
                v_suffix := v_suffix + 1;
                v_slug := format(
                    'geral-%s%s',
                    substr(md5(v_cliente_id::text), 1, 8),
                    CASE WHEN v_suffix = 1 THEN '' ELSE '-' || v_suffix::text END
                );
            END LOOP;

            INSERT INTO ap.visual_title_groups (
                cliente_id,
                nome,
                slug,
                ordem,
                ativo
            )
            VALUES (v_cliente_id, 'Geral', v_slug, 0, true)
            RETURNING id INTO v_group_id;
        END IF;

        UPDATE ap.visual_titles
        SET group_id = v_group_id
        WHERE cliente_id = v_cliente_id
          AND group_id IS NULL;
    END LOOP;
END;
$$;

ALTER TABLE ap.visual_title_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS visual_title_groups_select_own_client ON ap.visual_title_groups;
DROP POLICY IF EXISTS visual_title_groups_insert_own_client ON ap.visual_title_groups;
DROP POLICY IF EXISTS visual_title_groups_update_own_client ON ap.visual_title_groups;

CREATE POLICY visual_title_groups_select_own_client
    ON ap.visual_title_groups
    FOR SELECT
    TO authenticated
    USING (cliente_id IN (SELECT ap.get_user_cliente_ids()));

CREATE POLICY visual_title_groups_insert_own_client
    ON ap.visual_title_groups
    FOR INSERT
    TO authenticated
    WITH CHECK (cliente_id IN (SELECT ap.get_user_cliente_ids()));

CREATE POLICY visual_title_groups_update_own_client
    ON ap.visual_title_groups
    FOR UPDATE
    TO authenticated
    USING (cliente_id IN (SELECT ap.get_user_cliente_ids()))
    WITH CHECK (cliente_id IN (SELECT ap.get_user_cliente_ids()));

DROP TRIGGER IF EXISTS trg_ap_visual_title_groups_updated_at ON ap.visual_title_groups;
CREATE TRIGGER trg_ap_visual_title_groups_updated_at
    BEFORE UPDATE ON ap.visual_title_groups
    FOR EACH ROW EXECUTE FUNCTION ap.set_updated_at();

-- Administration archives records with ativo=false. Keep DELETE unavailable to
-- authenticated users, and grant the service role only the catalogue reads that
-- the generator needs.
REVOKE ALL PRIVILEGES ON ap.visual_title_groups FROM anon;
REVOKE ALL PRIVILEGES ON ap.visual_titles FROM anon;
GRANT SELECT, INSERT, UPDATE ON ap.visual_title_groups TO authenticated;
REVOKE DELETE ON ap.visual_title_groups FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON ap.visual_titles TO authenticated;
REVOKE DELETE ON ap.visual_titles FROM authenticated;
REVOKE ALL PRIVILEGES ON ap.visual_title_groups FROM service_role;
REVOKE ALL PRIVILEGES ON ap.visual_titles FROM service_role;
GRANT SELECT ON ap.visual_title_groups, ap.visual_titles TO service_role;

-- Keep unrelated ap-images paths compatible while closing the broad historical
-- policies for the immutable visual-titles/<cliente_id>/... prefix. These
-- policies deliberately permit no UPDATE or DELETE for visual-title assets.
DROP POLICY IF EXISTS "Give auth insert access to ap-images" ON storage.objects;
DROP POLICY IF EXISTS "Give auth update access to ap-images" ON storage.objects;
DROP POLICY IF EXISTS "Give auth delete access to ap-images" ON storage.objects;
DROP POLICY IF EXISTS ap_images_authenticated_insert_scoped ON storage.objects;
DROP POLICY IF EXISTS ap_images_authenticated_update_non_visual_titles ON storage.objects;
DROP POLICY IF EXISTS ap_images_authenticated_delete_non_visual_titles ON storage.objects;

CREATE POLICY ap_images_authenticated_insert_scoped
    ON storage.objects
    FOR INSERT
    TO authenticated
    WITH CHECK (
        bucket_id = 'ap-images'
        AND (
            (storage.foldername(name))[1] IS DISTINCT FROM 'visual-titles'
            OR (storage.foldername(name))[2] IN (
                SELECT ap.get_user_cliente_ids()::text
            )
        )
    );

CREATE POLICY ap_images_authenticated_update_non_visual_titles
    ON storage.objects
    FOR UPDATE
    TO authenticated
    USING (
        bucket_id = 'ap-images'
        AND (storage.foldername(name))[1] IS DISTINCT FROM 'visual-titles'
    )
    WITH CHECK (
        bucket_id = 'ap-images'
        AND (storage.foldername(name))[1] IS DISTINCT FROM 'visual-titles'
    );

CREATE POLICY ap_images_authenticated_delete_non_visual_titles
    ON storage.objects
    FOR DELETE
    TO authenticated
    USING (
        bucket_id = 'ap-images'
        AND (storage.foldername(name))[1] IS DISTINCT FROM 'visual-titles'
    );
