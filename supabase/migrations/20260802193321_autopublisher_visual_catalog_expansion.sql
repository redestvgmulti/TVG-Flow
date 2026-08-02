-- AutoPublisher visual catalog structural expansion. Local rollout artifact only.
--
-- This migration is global, structural, additive and fail-closed:
-- * visual_model remains the domain key;
-- * misto remains temporarily accepted for live tenant compatibility;
-- * no master row, candidate row or frozen snapshot is updated;
-- * tenant-specific normalization and catalog data live in the next migration.

ALTER TABLE ap.master_render_configs
    ADD COLUMN IF NOT EXISTS sponsor_count smallint;

ALTER TABLE ap.master_render_configs
    DROP CONSTRAINT IF EXISTS master_render_configs_sponsor_count_check;
ALTER TABLE ap.master_render_configs
    ADD CONSTRAINT master_render_configs_sponsor_count_check
    CHECK (sponsor_count IS NULL OR sponsor_count IN (0, 1, 2));

ALTER TABLE ap.master_render_configs
    DROP CONSTRAINT IF EXISTS master_render_configs_visual_model_check;
ALTER TABLE ap.master_render_configs
    ADD CONSTRAINT master_render_configs_visual_model_check
    CHECK (
        visual_model IN (
            'tvg', 'misto', 'tvg_img', 'individual', 'aparecida', 'story'
        )
    );

ALTER TABLE ap.master_render_configs
    DROP CONSTRAINT IF EXISTS master_render_configs_content_type_check;
ALTER TABLE ap.master_render_configs
    ADD CONSTRAINT master_render_configs_content_type_check
    CHECK (content_type IN ('feed', 'reels', 'story'));

CREATE UNIQUE INDEX IF NOT EXISTS uq_master_render_config_per_visual_model
    ON ap.master_render_configs (cliente_id, content_type, visual_model);

CREATE INDEX IF NOT EXISTS idx_master_render_configs_visual_model_lookup
    ON ap.master_render_configs (cliente_id, content_type, visual_model)
    WHERE enabled;

ALTER TABLE ap.visual_titles
    DROP CONSTRAINT IF EXISTS visual_titles_formatos_validos;
ALTER TABLE ap.visual_titles
    ADD CONSTRAINT visual_titles_formatos_validos
    CHECK (
        formatos <@ ARRAY['feed', 'reels', 'story']::text[]
        AND cardinality(formatos) > 0
    );

ALTER TABLE ap.render_sponsor_scope_memberships
    DROP CONSTRAINT IF EXISTS render_sponsor_scope_memberships_content_type_check;
ALTER TABLE ap.render_sponsor_scope_memberships
    ADD CONSTRAINT render_sponsor_scope_memberships_content_type_check
    CHECK (content_type IN ('feed', 'reels', 'story'));

ALTER TABLE ap.render_sponsor_rotation_state
    DROP CONSTRAINT IF EXISTS render_sponsor_rotation_state_content_type_check;
ALTER TABLE ap.render_sponsor_rotation_state
    ADD CONSTRAINT render_sponsor_rotation_state_content_type_check
    CHECK (content_type IN ('feed', 'reels', 'story'));

COMMENT ON COLUMN ap.master_render_configs.visual_model IS
    'AutoPublisher artwork purpose. New flows use tvg, tvg_img, individual, '
    'aparecida or story; misto remains temporarily accepted for live compatibility.';
COMMENT ON COLUMN ap.master_render_configs.sponsor_count IS
    'Backend-owned sponsor slot count for an exact tenant, format and visual model. NULL keeps an uninspected preset unavailable.';

-- Preserve the existing feed/reels implementation byte-for-byte and only
-- widen its validated format set to Story. Rotation, locking and snapshot
-- semantics remain the same.
CREATE OR REPLACE FUNCTION ap.create_candidate_with_sponsors_core_v1(
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
    v_content_type text := lower(btrim(p_content_type));
    v_template_set text := lower(btrim(p_template_set));
    v_request jsonb;
    v_existing ap.candidate_news%ROWTYPE;
    v_existing_request jsonb;
    v_template jsonb;
    v_template_id uuid;
    v_template_set_effective text;
    v_master_uuid text;
    v_uses_fixed_matrix boolean;
    v_visual_title jsonb;
    v_pool jsonb[] := ARRAY[]::jsonb[];
    v_pool_size integer := 0;
    v_cursor_stored integer := 0;
    v_cursor_before integer := 0;
    v_cursor_after integer := 0;
    v_offset integer;
    v_item jsonb;
    v_items jsonb := '[]'::jsonb;
    v_selection_id uuid := gen_random_uuid();
    v_selected_at timestamptz := clock_timestamp();
    v_sponsor_selection jsonb;
    v_snapshot jsonb;
    v_news ap.candidate_news%ROWTYPE;
BEGIN
    IF p_cliente_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.clientes c WHERE c.id = p_cliente_id
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

    IF v_content_type NOT IN ('feed', 'reels', 'story') THEN
        RAISE EXCEPTION 'CONTENT_TYPE_INVALID'
            USING ERRCODE = '22023';
    END IF;

    IF v_template_set IS NULL
       OR v_template_set = ''
       OR v_template_set !~ '^[a-z0-9][a-z0-9_-]*$' THEN
        RAISE EXCEPTION 'TEMPLATE_SET_INVALID'
            USING ERRCODE = '22023';
    END IF;

    IF p_sponsor_count IS NULL OR p_sponsor_count NOT IN (0, 1, 2) THEN
        RAISE EXCEPTION 'SPONSOR_COUNT_INVALID'
            USING ERRCODE = '22023';
    END IF;

    IF p_titulo IS NULL OR length(btrim(p_titulo)) < 2 THEN
        RAISE EXCEPTION 'TITLE_INVALID'
            USING ERRCODE = '22023';
    END IF;

    IF p_render_contract_version NOT IN ('legacy', 'master_v1') THEN
        RAISE EXCEPTION 'RENDER_CONTRACT_VERSION_INVALID'
            USING ERRCODE = '22023';
    END IF;

    IF p_render_snapshot_base IS NULL
       OR jsonb_typeof(p_render_snapshot_base) <> 'object' THEN
        RAISE EXCEPTION 'RENDER_SNAPSHOT_BASE_INVALID'
            USING ERRCODE = '22023';
    END IF;

    v_request := jsonb_build_object(
        'content_type', v_content_type,
        'template_set', v_template_set,
        'sponsor_count', p_sponsor_count,
        'titulo', btrim(p_titulo),
        'conteudo', p_conteudo,
        'url_original', p_url_original,
        'imagem_url', p_imagem_url,
        'context_tag', p_context_tag,
        'auth_user_id', p_auth_user_id,
        'visual_title_id', p_visual_title_id,
        'render_contract_version', p_render_contract_version,
        'render_snapshot_base', p_render_snapshot_base
    );

    -- Serializes retries for the same tenant/key before either queue is touched.
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
        v_existing_request := v_existing.render_snapshot
            #> ARRAY['idempotency', 'request'];

        IF v_existing_request IS NULL
           OR v_existing_request IS DISTINCT FROM v_request THEN
            RAISE EXCEPTION 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH'
                USING ERRCODE = '22023';
        END IF;

        RETURN jsonb_build_object(
            'reused', true,
            'candidate_news', to_jsonb(v_existing),
            'template', v_existing.render_snapshot -> 'template',
            'sponsor_selection',
                v_existing.render_snapshot -> 'sponsor_selection',
            'render_snapshot', v_existing.render_snapshot
        );
    END IF;

    IF p_visual_title_id IS NOT NULL THEN
        SELECT jsonb_build_object(
            'id', t.id,
            'name', t.nome,
            'slug', t.slug,
            'bucket', t.asset_bucket,
            'path', t.asset_path,
            'version', t.asset_version,
            'sha256', t.sha256
        )
        INTO v_visual_title
        FROM ap.visual_titles t
        WHERE t.id = p_visual_title_id
          AND t.cliente_id = p_cliente_id
          AND t.ativo
          AND v_content_type = ANY (t.formatos);

        IF v_visual_title IS NULL THEN
            RAISE EXCEPTION 'VISUAL_TITLE_INVALID'
                USING ERRCODE = '22023';
        END IF;
    END IF;

    -- The fixed matrix already resolved the template: master_v1 carries its
    -- frozen UUID in the snapshot base and must not consume the legacy queue.
    v_master_uuid := NULLIF(
        p_render_snapshot_base #>> ARRAY['master_config', 'master_template_uuid'],
        ''
    );
    v_uses_fixed_matrix :=
        p_render_contract_version = 'master_v1' AND v_master_uuid IS NOT NULL;

    IF v_uses_fixed_matrix THEN
        v_template_id := NULL;
        v_template_set_effective := v_template_set;
        v_template := jsonb_build_object(
            'id', NULL,
            'placid_template_uuid', v_master_uuid,
            'nome', NULL,
            'ordem', NULL
        );
    ELSE
        -- Nested PL/pgSQL call: template cursor and usage_total share this transaction.
        v_template := ap.get_and_advance_template(
            p_cliente_id,
            v_content_type,
            v_template_set
        );

        IF v_template IS NULL
           OR NULLIF(v_template ->> 'placid_template_uuid', '') IS NULL THEN
            RAISE EXCEPTION 'TEMPLATE_NOT_FOUND'
                USING ERRCODE = 'P0001';
        END IF;

        v_template_id := NULLIF(v_template ->> 'id', '')::uuid;
        v_template_set_effective :=
            COALESCE(NULLIF(v_template ->> 'template_set', ''), v_template_set);
    END IF;

    IF p_sponsor_count > 0 THEN
        SELECT
            COALESCE(
                array_agg(
                    jsonb_build_object(
                        'sponsor_id', s.id,
                        'name', s.nome,
                        'bucket', s.asset_bucket,
                        'path', s.asset_path,
                        'version', s.asset_version,
                        'sha256', s.sha256
                    )
                    ORDER BY m.ordem, s.id
                ),
                ARRAY[]::jsonb[]
            ),
            count(*)::integer
        INTO v_pool, v_pool_size
        FROM ap.render_sponsor_scope_memberships m
        JOIN ap.render_sponsors s
          ON s.id = m.sponsor_id
         AND s.cliente_id = m.cliente_id
        WHERE m.cliente_id = p_cliente_id
          AND m.template_set = v_template_set
          AND m.content_type = v_content_type
          AND m.ativo
          AND s.ativo;

        IF v_pool_size < p_sponsor_count THEN
            RAISE EXCEPTION
                'SPONSOR_POOL_INSUFFICIENT requested=% available=% scope=%/%',
                p_sponsor_count,
                v_pool_size,
                v_template_set,
                v_content_type
                USING ERRCODE = 'P0001';
        END IF;

        INSERT INTO ap.render_sponsor_rotation_state (
            cliente_id,
            template_set,
            content_type,
            current_index
        )
        VALUES (
            p_cliente_id,
            v_template_set,
            v_content_type,
            0
        )
        ON CONFLICT (cliente_id, template_set, content_type) DO NOTHING;

        SELECT state.current_index
        INTO v_cursor_stored
        FROM ap.render_sponsor_rotation_state state
        WHERE state.cliente_id = p_cliente_id
          AND state.template_set = v_template_set
          AND state.content_type = v_content_type
        FOR UPDATE;

        v_cursor_before := v_cursor_stored % v_pool_size;
        v_cursor_after :=
            (v_cursor_before + p_sponsor_count::integer) % v_pool_size;

        FOR v_offset IN 0..(p_sponsor_count::integer - 1) LOOP
            v_item := v_pool[
                ((v_cursor_before + v_offset) % v_pool_size) + 1
            ];
            v_items := v_items || jsonb_build_array(
                v_item || jsonb_build_object(
                    'slot',
                    CASE
                        WHEN v_offset = 0 THEN 'sponsor_1'
                        ELSE 'sponsor_2'
                    END
                )
            );
        END LOOP;

        UPDATE ap.render_sponsor_rotation_state state
        SET current_index = v_cursor_after
        WHERE state.cliente_id = p_cliente_id
          AND state.template_set = v_template_set
          AND state.content_type = v_content_type;
    END IF;

    v_sponsor_selection := jsonb_build_object(
        'requested_count', p_sponsor_count,
        'rotation_version', 'sponsor_rotation_v1',
        'selection_id', v_selection_id,
        'selected_at', v_selected_at,
        'scope', jsonb_build_object(
            'cliente_id', p_cliente_id,
            'template_set', v_template_set,
            'content_type', v_content_type
        ),
        'pool_size_at_selection', v_pool_size,
        'cursor_before', v_cursor_before,
        'cursor_after', v_cursor_after,
        'items', v_items
    );

    v_snapshot := p_render_snapshot_base || jsonb_build_object(
        'resolved_at', v_selected_at,
        'render_contract_version', p_render_contract_version,
        'format', v_content_type,
        'template', jsonb_build_object(
            'id', v_template_id,
            'legacy_placid_template_uuid',
                v_template ->> 'placid_template_uuid',
            'name', v_template ->> 'nome',
            'ordem', (v_template ->> 'ordem')::integer,
            'template_set_requested', v_template_set,
            'template_set_effective', v_template_set_effective
        ),
        'visual_title', v_visual_title,
        'sponsor_source', 'rotation_v1',
        'sponsor_selection', v_sponsor_selection,
        'idempotency', jsonb_build_object(
            'key', p_idempotency_key,
            'request', v_request
        )
    );

    INSERT INTO ap.candidate_news (
        cliente_id,
        status,
        titulo,
        conteudo,
        url_original,
        imagem_url,
        content_type,
        template_set,
        template_id,
        template_ordem,
        placid_template_uuid,
        template_nome_snapshot,
        visual_title_id,
        render_contract_version,
        render_snapshot,
        sponsor_count,
        idempotency_key,
        criado_por_user_id,
        role_criador,
        gerado_em
    )
    VALUES (
        p_cliente_id,
        'processing',
        btrim(p_titulo),
        p_conteudo,
        COALESCE(p_url_original, ''),
        p_imagem_url,
        v_content_type,
        v_template_set,
        v_template_id,
        (v_template ->> 'ordem')::integer,
        v_template ->> 'placid_template_uuid',
        v_template ->> 'nome',
        p_visual_title_id,
        p_render_contract_version,
        v_snapshot,
        p_sponsor_count,
        p_idempotency_key,
        p_auth_user_id,
        'employee',
        v_selected_at
    )
    RETURNING *
    INTO v_news;

    RETURN jsonb_build_object(
        'reused', false,
        'candidate_news', to_jsonb(v_news),
        'template', v_snapshot -> 'template',
        'sponsor_selection', v_sponsor_selection,
        'render_snapshot', v_snapshot
    );
END;
$function$;

-- New sponsors receive all three format memberships transactionally.
CREATE OR REPLACE FUNCTION ap.create_render_sponsor(
    p_cliente_id uuid,
    p_nome text,
    p_asset_bucket text,
    p_asset_path text,
    p_asset_version text,
    p_sha256 text,
    p_ativo boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
    v_jwt_role text := COALESCE(auth.jwt() ->> 'role', '');
    v_nome text := btrim(COALESCE(p_nome, ''));
    v_base text;
    v_slug text;
    v_attempt integer := 1;
    v_sponsor ap.render_sponsors%ROWTYPE;
    v_scope text := 'default';
    v_format text;
    v_ordem integer;
    v_memberships jsonb := '[]'::jsonb;
BEGIN
    IF p_cliente_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.clientes c WHERE c.id = p_cliente_id
    ) THEN
        RAISE EXCEPTION 'CLIENTE_NOT_FOUND'
            USING ERRCODE = '23503';
    END IF;

    -- Same tenant gate as the candidate RPC: a caller can only ever write into
    -- a client it is explicitly authorized for.
    IF v_jwt_role <> 'service_role'
       AND NOT EXISTS (
           SELECT 1
           FROM ap.get_user_cliente_ids() AS allowed(cliente_id)
           WHERE allowed.cliente_id = p_cliente_id
       ) THEN
        RAISE EXCEPTION 'CLIENT_ACCESS_DENIED'
            USING ERRCODE = '42501';
    END IF;

    IF length(v_nome) = 0 THEN
        RAISE EXCEPTION 'SPONSOR_NAME_REQUIRED'
            USING ERRCODE = '22023';
    END IF;

    v_base := ap.slugify_sponsor(v_nome);
    IF length(v_base) = 0 THEN
        RAISE EXCEPTION 'SPONSOR_NAME_INVALID'
            USING ERRCODE = '22023';
    END IF;

    IF COALESCE(btrim(p_asset_bucket), '') = ''
       OR COALESCE(btrim(p_asset_path), '') = ''
       OR COALESCE(btrim(p_asset_version), '') = ''
       OR COALESCE(p_sha256, '') !~ '^[0-9a-f]{64}$' THEN
        RAISE EXCEPTION 'SPONSOR_ASSET_INVALID'
            USING ERRCODE = '22023';
    END IF;

    -- Serializes concurrent registrations for this tenant so both the slug
    -- suffix and the append position are computed on a stable view.
    PERFORM pg_advisory_xact_lock(
        hashtextextended('ap.render_sponsors:' || p_cliente_id::text, 0)
    );

    -- Deterministic collision handling: "clinica-vida", then "clinica-vida-2".
    v_slug := v_base;
    WHILE EXISTS (
        SELECT 1 FROM ap.render_sponsors s
        WHERE s.cliente_id = p_cliente_id AND s.slug = v_slug
    ) LOOP
        v_attempt := v_attempt + 1;
        v_slug := v_base || '-' || v_attempt::text;
    END LOOP;

    INSERT INTO ap.render_sponsors (
        cliente_id, nome, slug,
        asset_bucket, asset_path, asset_version, sha256, ativo
    )
    VALUES (
        p_cliente_id, v_nome, v_slug,
        btrim(p_asset_bucket), btrim(p_asset_path), btrim(p_asset_version),
        p_sha256, COALESCE(p_ativo, true)
    )
    RETURNING * INTO v_sponsor;

    -- All supported formats, always. Eligibility is a consequence of being registered
    -- and active, never a separate operator action.
    FOREACH v_format IN ARRAY ARRAY['feed', 'reels', 'story'] LOOP
        SELECT COALESCE(max(m.ordem) + 1, 0)
        INTO v_ordem
        FROM ap.render_sponsor_scope_memberships m
        WHERE m.cliente_id = p_cliente_id
          AND m.template_set = v_scope
          AND m.content_type = v_format;

        INSERT INTO ap.render_sponsor_scope_memberships (
            sponsor_id, cliente_id, template_set, content_type, ordem, ativo
        )
        VALUES (
            v_sponsor.id, p_cliente_id, v_scope, v_format, v_ordem, true
        )
        ON CONFLICT (cliente_id, template_set, content_type, sponsor_id)
        DO NOTHING;

        v_memberships := v_memberships || jsonb_build_array(
            jsonb_build_object(
                'content_type', v_format,
                'template_set', v_scope,
                'ordem', v_ordem
            )
        );
    END LOOP;

    RETURN jsonb_build_object(
        'sponsor', to_jsonb(v_sponsor),
        'memberships', v_memberships
    );
END;
$function$;

REVOKE ALL ON FUNCTION ap.create_render_sponsor(
    uuid, text, text, text, text, text, boolean
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION ap.create_render_sponsor(
    uuid, text, text, text, text, text, boolean
) TO authenticated, service_role;

COMMENT ON FUNCTION ap.create_render_sponsor(
    uuid, text, text, text, text, text, boolean
) IS
    'Registers a sponsor and its Feed, Reels and Story memberships in one transaction.';

NOTIFY pgrst, 'reload schema';
