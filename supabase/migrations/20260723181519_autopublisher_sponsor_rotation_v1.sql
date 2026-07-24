-- AutoPublisher sponsor_rotation_v1.
-- Additive only: legacy sponsors, template queues and template RPCs are untouched.

CREATE TABLE ap.render_sponsors (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cliente_id uuid NOT NULL REFERENCES public.clientes(id) ON DELETE RESTRICT,
    nome text NOT NULL,
    slug text NOT NULL,
    asset_bucket text NOT NULL,
    asset_path text NOT NULL,
    asset_version text NOT NULL,
    sha256 text NOT NULL,
    ativo boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT render_sponsors_nome_nonempty
        CHECK (length(btrim(nome)) > 0),
    CONSTRAINT render_sponsors_slug_normalized
        CHECK (slug = lower(btrim(slug)) AND slug ~ '^[a-z0-9][a-z0-9_-]*$'),
    CONSTRAINT render_sponsors_asset_bucket_nonempty
        CHECK (length(btrim(asset_bucket)) > 0),
    CONSTRAINT render_sponsors_asset_path_nonempty
        CHECK (length(btrim(asset_path)) > 0),
    CONSTRAINT render_sponsors_asset_version_nonempty
        CHECK (length(btrim(asset_version)) > 0),
    CONSTRAINT render_sponsors_sha256_valid
        CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT render_sponsors_slug_per_cliente
        UNIQUE (cliente_id, slug),
    CONSTRAINT render_sponsors_cliente_id_id_unique
        UNIQUE (cliente_id, id)
);

CREATE INDEX idx_render_sponsors_cliente_active
    ON ap.render_sponsors (cliente_id, slug)
    WHERE ativo;

CREATE TABLE ap.render_sponsor_scope_memberships (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    sponsor_id uuid NOT NULL,
    cliente_id uuid NOT NULL REFERENCES public.clientes(id) ON DELETE RESTRICT,
    template_set text NOT NULL,
    content_type text NOT NULL,
    ordem integer NOT NULL DEFAULT 0,
    ativo boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT render_sponsor_scope_memberships_sponsor_owner_fkey
        FOREIGN KEY (cliente_id, sponsor_id)
        REFERENCES ap.render_sponsors (cliente_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT render_sponsor_scope_memberships_template_set_normalized
        CHECK (
            template_set = lower(btrim(template_set))
            AND template_set ~ '^[a-z0-9][a-z0-9_-]*$'
        ),
    CONSTRAINT render_sponsor_scope_memberships_content_type_check
        CHECK (content_type IN ('feed', 'reels')),
    CONSTRAINT render_sponsor_scope_memberships_ordem_nonnegative
        CHECK (ordem >= 0),
    CONSTRAINT render_sponsor_scope_memberships_sponsor_scope_unique
        UNIQUE (cliente_id, template_set, content_type, sponsor_id)
);

CREATE INDEX idx_render_sponsor_scope_eligible
    ON ap.render_sponsor_scope_memberships (
        cliente_id,
        template_set,
        content_type,
        ordem,
        sponsor_id
    )
    WHERE ativo;

CREATE INDEX idx_render_sponsor_scope_sponsor_id
    ON ap.render_sponsor_scope_memberships (sponsor_id);

CREATE TABLE ap.render_sponsor_rotation_state (
    cliente_id uuid NOT NULL REFERENCES public.clientes(id) ON DELETE RESTRICT,
    template_set text NOT NULL,
    content_type text NOT NULL,
    current_index integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT render_sponsor_rotation_state_pkey
        PRIMARY KEY (cliente_id, template_set, content_type),
    CONSTRAINT render_sponsor_rotation_state_template_set_normalized
        CHECK (
            template_set = lower(btrim(template_set))
            AND template_set ~ '^[a-z0-9][a-z0-9_-]*$'
        ),
    CONSTRAINT render_sponsor_rotation_state_content_type_check
        CHECK (content_type IN ('feed', 'reels')),
    CONSTRAINT render_sponsor_rotation_state_current_index_nonnegative
        CHECK (current_index >= 0)
);

ALTER TABLE ap.candidate_news
    ADD COLUMN sponsor_count smallint,
    ADD COLUMN idempotency_key uuid;

ALTER TABLE ap.candidate_news
    ADD CONSTRAINT candidate_news_sponsor_count_check
    CHECK (sponsor_count IS NULL OR sponsor_count IN (0, 1, 2));

CREATE UNIQUE INDEX uq_candidate_news_cliente_idempotency
    ON ap.candidate_news (cliente_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

COMMENT ON COLUMN ap.candidate_news.sponsor_count IS
    'NULL means legacy/previous contract; 0, 1 or 2 is the requested sponsor count for sponsor_rotation_v1.';
COMMENT ON COLUMN ap.candidate_news.idempotency_key IS
    'Client-generated key used to return the same candidate and immutable sponsor selection on retry.';

ALTER TABLE ap.render_sponsors ENABLE ROW LEVEL SECURITY;
ALTER TABLE ap.render_sponsor_scope_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE ap.render_sponsor_rotation_state ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
    ap.render_sponsors,
    ap.render_sponsor_scope_memberships,
    ap.render_sponsor_rotation_state
FROM PUBLIC, anon;

GRANT USAGE ON SCHEMA ap TO authenticated, service_role;

GRANT SELECT, INSERT, UPDATE ON TABLE
    ap.render_sponsors,
    ap.render_sponsor_scope_memberships
TO authenticated, service_role;

GRANT SELECT ON TABLE ap.render_sponsor_rotation_state
TO authenticated, service_role;

CREATE POLICY render_sponsors_tenant_isolation
ON ap.render_sponsors
FOR ALL
TO authenticated
USING (
    cliente_id IN (SELECT ap.get_user_cliente_ids())
)
WITH CHECK (
    cliente_id IN (SELECT ap.get_user_cliente_ids())
);

CREATE POLICY render_sponsor_scope_memberships_tenant_isolation
ON ap.render_sponsor_scope_memberships
FOR ALL
TO authenticated
USING (
    cliente_id IN (SELECT ap.get_user_cliente_ids())
)
WITH CHECK (
    cliente_id IN (SELECT ap.get_user_cliente_ids())
);

CREATE POLICY render_sponsor_rotation_state_read
ON ap.render_sponsor_rotation_state
FOR SELECT
TO authenticated
USING (
    cliente_id IN (SELECT ap.get_user_cliente_ids())
);

CREATE TRIGGER trg_ap_render_sponsors_updated_at
BEFORE UPDATE ON ap.render_sponsors
FOR EACH ROW EXECUTE FUNCTION ap.set_updated_at();

CREATE TRIGGER trg_ap_render_sponsor_scope_memberships_updated_at
BEFORE UPDATE ON ap.render_sponsor_scope_memberships
FOR EACH ROW EXECUTE FUNCTION ap.set_updated_at();

CREATE TRIGGER trg_ap_render_sponsor_rotation_state_updated_at
BEFORE UPDATE ON ap.render_sponsor_rotation_state
FOR EACH ROW EXECUTE FUNCTION ap.set_updated_at();

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
    v_content_type text := lower(btrim(p_content_type));
    v_template_set text := lower(btrim(p_template_set));
    v_request jsonb;
    v_existing ap.candidate_news%ROWTYPE;
    v_existing_request jsonb;
    v_template jsonb;
    v_template_id uuid;
    v_template_set_effective text;
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
