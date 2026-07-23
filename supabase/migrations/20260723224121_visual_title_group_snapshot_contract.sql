-- G4: validate visual-title groups for new candidates while keeping retries
-- bound to the immutable snapshot stored by sponsor_rotation_v1.

DO $migration$
BEGIN
    IF to_regprocedure(
        'ap.create_candidate_with_sponsors_core_v1(uuid,uuid,text,text,smallint,text,text,text,text,text,uuid,uuid,text,jsonb)'
    ) IS NULL THEN
        ALTER FUNCTION ap.create_candidate_with_sponsors(
            uuid,
            uuid,
            text,
            text,
            smallint,
            text,
            text,
            text,
            text,
            text,
            uuid,
            uuid,
            text,
            jsonb
        ) RENAME TO create_candidate_with_sponsors_core_v1;
    END IF;
END;
$migration$;

CREATE OR REPLACE FUNCTION ap.create_candidate_with_sponsors(
    p_cliente_id uuid,
    p_idempotency_key uuid,
    p_content_type text,
    p_template_set text,
    p_sponsor_count smallint,
    p_titulo text,
    p_conteudo text DEFAULT NULL,
    p_url_original text DEFAULT NULL,
    p_imagem_url text DEFAULT NULL,
    p_context_tag text DEFAULT NULL,
    p_auth_user_id uuid DEFAULT NULL,
    p_visual_title_id uuid DEFAULT NULL,
    p_render_contract_version text DEFAULT 'legacy',
    p_render_snapshot_base jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
    v_jwt_role text := COALESCE(auth.jwt() ->> 'role', '');
    v_existing ap.candidate_news%ROWTYPE;
    v_title ap.visual_titles%ROWTYPE;
    v_group ap.visual_title_groups%ROWTYPE;
    v_result jsonb;
    v_snapshot jsonb;
    v_visual_title jsonb;
    v_candidate jsonb;
    v_candidate_id uuid;
BEGIN
    IF p_cliente_id IS NULL OR NOT EXISTS (
        SELECT 1
        FROM public.clientes c
        WHERE c.id = p_cliente_id
    ) THEN
        RAISE EXCEPTION 'CLIENTE_NOT_FOUND'
            USING ERRCODE = '23503';
    END IF;

    IF v_jwt_role <> 'service_role'
       AND NOT EXISTS (
           SELECT 1
           FROM ap.get_user_cliente_ids() AS allowed(cliente_id)
           WHERE allowed.cliente_id = p_cliente_id
       ) THEN
        RAISE EXCEPTION 'CLIENT_ACCESS_DENIED'
            USING ERRCODE = '42501';
    END IF;

    IF v_jwt_role <> 'service_role'
       AND p_auth_user_id IS NOT NULL
       AND p_auth_user_id IS DISTINCT FROM auth.uid() THEN
        RAISE EXCEPTION 'AUTH_USER_MISMATCH'
            USING ERRCODE = '42501';
    END IF;

    IF p_idempotency_key IS NULL THEN
        RAISE EXCEPTION 'IDEMPOTENCY_KEY_REQUIRED'
            USING ERRCODE = '22023';
    END IF;

    -- The wrapper and core use the same transaction-scoped lock. Retries are
    -- identified before any current catalog state is consulted.
    PERFORM pg_advisory_xact_lock(
        hashtextextended(
            p_cliente_id::text || ':' || p_idempotency_key::text,
            0
        )
    );

    SELECT *
    INTO v_existing
    FROM ap.candidate_news n
    WHERE n.cliente_id = p_cliente_id
      AND n.idempotency_key = p_idempotency_key
    FOR UPDATE;

    IF FOUND THEN
        RETURN ap.create_candidate_with_sponsors_core_v1(
            p_cliente_id,
            p_idempotency_key,
            p_content_type,
            p_template_set,
            p_sponsor_count,
            p_titulo,
            p_conteudo,
            p_url_original,
            p_imagem_url,
            p_context_tag,
            p_auth_user_id,
            p_visual_title_id,
            p_render_contract_version,
            p_render_snapshot_base
        );
    END IF;

    IF p_visual_title_id IS NOT NULL THEN
        SELECT *
        INTO v_title
        FROM ap.visual_titles t
        WHERE t.id = p_visual_title_id
          AND t.cliente_id = p_cliente_id
        FOR SHARE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'VISUAL_TITLE_NOT_FOUND'
                USING ERRCODE = '22023';
        END IF;

        IF NOT v_title.ativo THEN
            RAISE EXCEPTION 'VISUAL_TITLE_INACTIVE'
                USING ERRCODE = '22023';
        END IF;

        IF lower(btrim(p_content_type)) <> ALL (v_title.formatos) THEN
            RAISE EXCEPTION 'VISUAL_TITLE_FORMAT_INVALID'
                USING ERRCODE = '22023';
        END IF;

        IF NULLIF(btrim(v_title.asset_bucket), '') IS NULL
           OR NULLIF(btrim(v_title.asset_path), '') IS NULL
           OR NULLIF(btrim(v_title.asset_version), '') IS NULL
           OR NULLIF(btrim(v_title.sha256), '') IS NULL THEN
            RAISE EXCEPTION 'VISUAL_TITLE_ASSET_INVALID'
                USING ERRCODE = '22023';
        END IF;

        IF v_title.group_id IS NOT NULL THEN
            SELECT *
            INTO v_group
            FROM ap.visual_title_groups g
            WHERE g.id = v_title.group_id
              AND g.cliente_id = p_cliente_id
            FOR SHARE;

            IF NOT FOUND THEN
                RAISE EXCEPTION 'VISUAL_TITLE_GROUP_NOT_FOUND'
                    USING ERRCODE = '22023';
            END IF;

            IF NOT v_group.ativo THEN
                RAISE EXCEPTION 'VISUAL_TITLE_GROUP_INACTIVE'
                    USING ERRCODE = '22023';
            END IF;
        END IF;
    END IF;

    v_result := ap.create_candidate_with_sponsors_core_v1(
        p_cliente_id,
        p_idempotency_key,
        p_content_type,
        p_template_set,
        p_sponsor_count,
        p_titulo,
        p_conteudo,
        p_url_original,
        p_imagem_url,
        p_context_tag,
        p_auth_user_id,
        p_visual_title_id,
        p_render_contract_version,
        p_render_snapshot_base
    );

    IF p_visual_title_id IS NULL THEN
        RETURN v_result;
    END IF;

    v_snapshot := v_result -> 'render_snapshot';
    v_visual_title := COALESCE(
        v_snapshot -> 'visual_title',
        '{}'::jsonb
    ) || jsonb_build_object(
        'group_id', v_title.group_id,
        'group_name_at_selection',
            CASE WHEN v_title.group_id IS NULL THEN NULL ELSE v_group.nome END,
        'group_slug_at_selection',
            CASE WHEN v_title.group_id IS NULL THEN NULL ELSE v_group.slug END
    );
    v_snapshot := jsonb_set(
        v_snapshot,
        ARRAY['visual_title'],
        v_visual_title,
        true
    );
    v_candidate_id := (v_result #>> ARRAY['candidate_news', 'id'])::uuid;

    UPDATE ap.candidate_news n
    SET render_snapshot = v_snapshot
    WHERE n.id = v_candidate_id
      AND n.cliente_id = p_cliente_id
    RETURNING to_jsonb(n)
    INTO v_candidate;

    IF v_candidate IS NULL THEN
        RAISE EXCEPTION 'CANDIDATE_SNAPSHOT_UPDATE_FAILED'
            USING ERRCODE = 'P0001';
    END IF;

    RETURN v_result || jsonb_build_object(
        'candidate_news', v_candidate,
        'render_snapshot', v_snapshot
    );
END;
$function$;

REVOKE ALL ON FUNCTION ap.create_candidate_with_sponsors_core_v1(
    uuid,
    uuid,
    text,
    text,
    smallint,
    text,
    text,
    text,
    text,
    text,
    uuid,
    uuid,
    text,
    jsonb
) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION ap.create_candidate_with_sponsors(
    uuid,
    uuid,
    text,
    text,
    smallint,
    text,
    text,
    text,
    text,
    text,
    uuid,
    uuid,
    text,
    jsonb
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION ap.create_candidate_with_sponsors(
    uuid,
    uuid,
    text,
    text,
    smallint,
    text,
    text,
    text,
    text,
    text,
    uuid,
    uuid,
    text,
    jsonb
) TO authenticated, service_role;

COMMENT ON FUNCTION ap.create_candidate_with_sponsors(
    uuid,
    uuid,
    text,
    text,
    smallint,
    text,
    text,
    text,
    text,
    text,
    uuid,
    uuid,
    text,
    jsonb
) IS
'Creates an idempotent candidate after validating and snapshotting its visual-title group.';
