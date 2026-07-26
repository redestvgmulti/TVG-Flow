-- Sponsor administration becomes a three-field form (nome, PNG, ativo). Format
-- eligibility, rotation scope and ordering stop being operator decisions and
-- become an automatic consequence of registering a sponsor.
--
-- Registering used to be three client round-trips (insert sponsor, upsert feed
-- membership, upsert reels membership), which could leave a sponsor with no
-- membership, or with Feed but not Reels. This RPC makes it ONE transactional
-- statement: either the sponsor and both memberships exist, or nothing does.
--
-- Nothing about the rotation engine changes: the scope stays
-- (cliente_id, template_set='default', content_type), shared by TVG and Misto,
-- and ap.create_candidate_with_sponsors_core_v1 is untouched.

-- Deterministic, dependency-free slug (no unaccent extension required).
CREATE OR REPLACE FUNCTION ap.slugify_sponsor(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $function$
    SELECT btrim(
        regexp_replace(
            regexp_replace(
                lower(
                    translate(
                        COALESCE(p_value, ''),
                        'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
                        'aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN'
                    )
                ),
                '[^a-z0-9]+', '-', 'g'
            ),
            '(^-+|-+$)', '', 'g'
        ),
        '-'
    );
$function$;

COMMENT ON FUNCTION ap.slugify_sponsor(text) IS
    'Derives the sponsor identifier from its name. The operator never types or '
    'edits a slug.';

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

    -- Both formats, always. Eligibility is a consequence of being registered
    -- and active, never a separate operator action.
    FOREACH v_format IN ARRAY ARRAY['feed', 'reels'] LOOP
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

COMMENT ON FUNCTION ap.create_render_sponsor(
    uuid, text, text, text, text, text, boolean
) IS
    'Registers a sponsor and its Feed + Reels rotation memberships in one '
    'transaction. Ordering is appended automatically; the operator never picks '
    'a format, an order or a rotation scope.';

REVOKE ALL ON FUNCTION ap.create_render_sponsor(
    uuid, text, text, text, text, text, boolean
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION ap.create_render_sponsor(
    uuid, text, text, text, text, text, boolean
) TO authenticated, service_role;

REVOKE ALL ON FUNCTION ap.slugify_sponsor(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION ap.slugify_sponsor(text)
    TO authenticated, service_role;
