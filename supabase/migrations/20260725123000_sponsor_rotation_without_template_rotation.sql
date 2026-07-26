-- The four fixed Placid templates are addressed by (content_type,
-- visual_model), so master_v1 no longer needs the legacy template queue: the
-- correct UUID already arrives frozen in p_render_snapshot_base.master_config.
--
-- ap.get_and_advance_template RAISES when ap.templates has no active row for
-- the scope, which made every master_v1 creation depend on a legacy catalog
-- that the fixed matrix has made irrelevant. For master_v1 the rotation is now
-- skipped and legacy_placid_template_uuid is anchored to the master UUID
-- itself, so an explicit kill-switch fallback still renders the same template
-- (with legacy layer names) instead of failing with LEGACY_TEMPLATE_MISSING.
--
-- Everything else is preserved byte-for-byte: legacy contract keeps rotating,
-- sponsor pool/cursor/advisory lock/FOR UPDATE, idempotency replay semantics,
-- snapshot shape and the fail-closed insufficient-pool guard are untouched.
--
-- Layering (unchanged): ap.create_candidate_with_sponsors (idempotency wrapper,
-- 20260723235947) -> ap.create_candidate_with_sponsors_group_v1 (visual-title
-- group freezing, 20260723224121) -> ap.create_candidate_with_sponsors_core_v1
-- (rotation + insert, 20260723181519). Only the innermost core is redefined
-- here, so both outer layers keep their contracts intact.

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

    IF v_content_type NOT IN ('feed', 'reels') THEN
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
