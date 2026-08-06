-- Certifies that registering a sponsor is ONE transactional operation that
-- yields the sponsor plus all three format memberships, with automatic ordering,
-- and that no partial state can survive a failure.
-- Self-contained: everything runs inside one transaction and is rolled back.
\set ON_ERROR_STOP on
BEGIN;

\set cliente_a '33333333-3333-4333-8333-333333333333'
\set cliente_b '44444444-4444-4444-8444-444444444444'
\set sha_a '1111111111111111111111111111111111111111111111111111111111111111'
\set sha_b '2222222222222222222222222222222222222222222222222222222222222222'
\set sha_c '3333333333333333333333333333333333333333333333333333333333333333'

INSERT INTO public.clientes (id, nome)
VALUES (:'cliente_a', 'Tenant A sponsors'), (:'cliente_b', 'Tenant B sponsors')
ON CONFLICT (id) DO NOTHING;

SELECT set_config(
    'request.jwt.claims',
    '{"role":"service_role","sub":"33333333-3333-4333-8333-333333333333"}',
    true
) \gset

CREATE OR REPLACE FUNCTION pg_temp.assert_true(condition boolean, message text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF NOT COALESCE(condition, false) THEN
        RAISE EXCEPTION 'assertion failed: %', message;
    END IF;
END;
$$;

-- ── One call creates exactly the Feed, Reels and Story memberships ─────────
DO $$
DECLARE
    v jsonb;
    v_id uuid;
    v_formats text[];
    v_response_formats text[];
    v_scope_is_valid boolean;
BEGIN
    v := ap.create_render_sponsor(
        '33333333-3333-4333-8333-333333333333',
        'Clínica Vida',
        'ap-images', 'sponsors/a/clinica-vida/hash.png', 'v1',
        '1111111111111111111111111111111111111111111111111111111111111111',
        true);

    v_id := (v #>> '{sponsor,id}')::uuid;

    -- The identifier is derived from the name, never supplied.
    IF (v #>> '{sponsor,slug}') <> 'clinica-vida' THEN
        RAISE EXCEPTION 'ASSERTION: slug was not derived from the name (got %)',
            v #>> '{sponsor,slug}';
    END IF;

    SELECT
        array_agg(m.content_type ORDER BY m.content_type),
        bool_and(
            m.cliente_id = '33333333-3333-4333-8333-333333333333'
            AND m.template_set = 'default'
            AND m.ativo
        )
    INTO v_formats, v_scope_is_valid
    FROM ap.render_sponsor_scope_memberships AS m
    WHERE m.sponsor_id = v_id;

    IF v_formats IS DISTINCT FROM ARRAY['feed', 'reels', 'story']::text[] THEN
        RAISE EXCEPTION
            'ASSERTION: registration formats must be exactly feed,reels,story (got %)',
            v_formats;
    END IF;

    IF NOT COALESCE(v_scope_is_valid, false) THEN
        RAISE EXCEPTION
            'ASSERTION: a membership escaped the sponsor tenant or default active scope';
    END IF;

    SELECT array_agg(item ->> 'content_type' ORDER BY item ->> 'content_type')
    INTO v_response_formats
    FROM jsonb_array_elements(v -> 'memberships') AS item;

    IF v_response_formats IS DISTINCT FROM ARRAY['feed', 'reels', 'story']::text[] THEN
        RAISE EXCEPTION
            'ASSERTION: RPC response formats must be exactly feed,reels,story (got %)',
            v_response_formats;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM ap.render_sponsor_scope_memberships AS m
        WHERE m.cliente_id = '33333333-3333-4333-8333-333333333333'
          AND m.sponsor_id <> v_id
    ) THEN
        RAISE EXCEPTION
            'ASSERTION: registration associated a membership with the wrong sponsor';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM ap.render_sponsor_scope_memberships m
        WHERE m.sponsor_id = v_id AND m.content_type = 'feed'
          AND m.template_set = 'default' AND m.ativo
    ) THEN
        RAISE EXCEPTION 'ASSERTION: feed membership missing or out of scope';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM ap.render_sponsor_scope_memberships m
        WHERE m.sponsor_id = v_id AND m.content_type = 'reels'
          AND m.template_set = 'default' AND m.ativo
    ) THEN
        RAISE EXCEPTION 'ASSERTION: reels membership missing or out of scope';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM ap.render_sponsor_scope_memberships m
        WHERE m.sponsor_id = v_id AND m.content_type = 'story'
          AND m.template_set = 'default' AND m.ativo
    ) THEN
        RAISE EXCEPTION 'ASSERTION: story membership missing or out of scope';
    END IF;
    -- First sponsor of the tenant starts every format queue.

    IF (SELECT count(*) FROM ap.render_sponsor_scope_memberships m
        WHERE m.sponsor_id = v_id AND m.ordem = 0) <> 3 THEN
        RAISE EXCEPTION 'ASSERTION: first sponsor did not start at position 0';
    END IF;
END;
$$;

-- ── Ordering is automatic and appends to the end ───────────────────────────
DO $$
DECLARE
    v2 jsonb; v3 jsonb;
BEGIN
    v2 := ap.create_render_sponsor(
        '33333333-3333-4333-8333-333333333333', 'Padaria Central',
        'ap-images', 'sponsors/a/padaria/hash.png', 'v1',
        '2222222222222222222222222222222222222222222222222222222222222222', true);
    v3 := ap.create_render_sponsor(
        '33333333-3333-4333-8333-333333333333', 'Auto Peças Norte',
        'ap-images', 'sponsors/a/auto/hash.png', 'v1',
        '3333333333333333333333333333333333333333333333333333333333333333', true);

    IF (SELECT m.ordem FROM ap.render_sponsor_scope_memberships m
        WHERE m.sponsor_id = (v2 #>> '{sponsor,id}')::uuid
          AND m.content_type = 'feed') <> 1 THEN
        RAISE EXCEPTION 'ASSERTION: second sponsor did not append at feed position 1';
    END IF;

    IF (SELECT m.ordem FROM ap.render_sponsor_scope_memberships m
        WHERE m.sponsor_id = (v3 #>> '{sponsor,id}')::uuid
          AND m.content_type = 'reels') <> 2 THEN
        RAISE EXCEPTION 'ASSERTION: third sponsor did not append at reels position 2';
    END IF;
END;
$$;

-- ── Deterministic slug collision handling ─────────────────────────────────
DO $$
DECLARE v jsonb;
BEGIN
    v := ap.create_render_sponsor(
        '33333333-3333-4333-8333-333333333333', 'Clinica Vida',
        'ap-images', 'sponsors/a/clinica-vida-2/hash.png', 'v1',
        '4444444444444444444444444444444444444444444444444444444444444444', true);
    IF (v #>> '{sponsor,slug}') <> 'clinica-vida-2' THEN
        RAISE EXCEPTION 'ASSERTION: collision suffix was not deterministic (got %)',
            v #>> '{sponsor,slug}';
    END IF;
END;
$$;

-- ── No partial state: a rejected asset creates neither sponsor nor membership
DO $$
DECLARE v_before integer; v_after integer; v_mem_before integer; v_mem_after integer;
BEGIN
    SELECT count(*) INTO v_before FROM ap.render_sponsors
        WHERE cliente_id = '33333333-3333-4333-8333-333333333333';
    SELECT count(*) INTO v_mem_before FROM ap.render_sponsor_scope_memberships
        WHERE cliente_id = '33333333-3333-4333-8333-333333333333';

    BEGIN
        PERFORM ap.create_render_sponsor(
            '33333333-3333-4333-8333-333333333333', 'Sem Asset',
            'ap-images', 'sponsors/a/x.png', 'v1', 'nao-e-um-sha256', true);
        RAISE EXCEPTION 'ASSERTION: invalid asset was accepted';
    EXCEPTION WHEN sqlstate '22023' THEN
        NULL; -- expected
    END;

    SELECT count(*) INTO v_after FROM ap.render_sponsors
        WHERE cliente_id = '33333333-3333-4333-8333-333333333333';
    SELECT count(*) INTO v_mem_after FROM ap.render_sponsor_scope_memberships
        WHERE cliente_id = '33333333-3333-4333-8333-333333333333';

    IF v_after <> v_before OR v_mem_after <> v_mem_before THEN
        RAISE EXCEPTION 'ASSERTION: failed registration left partial state';
    END IF;

    -- An empty name is refused for the same reason.
    BEGIN
        PERFORM ap.create_render_sponsor(
            '33333333-3333-4333-8333-333333333333', '   ',
            'ap-images', 'sponsors/a/y.png', 'v1',
            '5555555555555555555555555555555555555555555555555555555555555555', true);
        RAISE EXCEPTION 'ASSERTION: empty name was accepted';
    EXCEPTION WHEN sqlstate '22023' THEN
        NULL;
    END;
END;
$$;

-- ── Cross-tenant registration is refused ──────────────────────────────────
DO $$
BEGIN
    PERFORM set_config('request.jwt.claims',
        '{"role":"authenticated","sub":"33333333-3333-4333-8333-333333333333"}', true);
    BEGIN
        PERFORM ap.create_render_sponsor(
            '44444444-4444-4444-8444-444444444444', 'Invasor',
            'ap-images', 'sponsors/b/x.png', 'v1',
            '6666666666666666666666666666666666666666666666666666666666666666', true);
        RAISE EXCEPTION 'ASSERTION: a foreign tenant was written';
    EXCEPTION WHEN sqlstate '42501' THEN
        NULL; -- expected
    END;
    PERFORM set_config('request.jwt.claims',
        '{"role":"service_role","sub":"33333333-3333-4333-8333-333333333333"}', true);
END;
$$;

-- ── Deactivating removes it from the pool without reordering the others ────
DO $$
DECLARE
    v_pool_before integer;
    v_pool_after integer;
    v_ordem_before integer;
    v_ordem_after integer;
    v_target uuid;
BEGIN
    SELECT s.id INTO v_target FROM ap.render_sponsors s
    WHERE s.cliente_id = '33333333-3333-4333-8333-333333333333'
      AND s.slug = 'padaria-central';

    SELECT count(*) INTO v_pool_before
    FROM ap.render_sponsor_scope_memberships m
    JOIN ap.render_sponsors s ON s.id = m.sponsor_id AND s.cliente_id = m.cliente_id
    WHERE m.cliente_id = '33333333-3333-4333-8333-333333333333'
      AND m.template_set = 'default' AND m.content_type = 'feed'
      AND m.ativo AND s.ativo;

    SELECT m.ordem INTO v_ordem_before
    FROM ap.render_sponsor_scope_memberships m
    WHERE m.sponsor_id = v_target AND m.content_type = 'feed';

    UPDATE ap.render_sponsors SET ativo = false WHERE id = v_target;

    SELECT count(*) INTO v_pool_after
    FROM ap.render_sponsor_scope_memberships m
    JOIN ap.render_sponsors s ON s.id = m.sponsor_id AND s.cliente_id = m.cliente_id
    WHERE m.cliente_id = '33333333-3333-4333-8333-333333333333'
      AND m.template_set = 'default' AND m.content_type = 'feed'
      AND m.ativo AND s.ativo;

    IF v_pool_after <> v_pool_before - 1 THEN
        RAISE EXCEPTION 'ASSERTION: deactivating did not remove it from the pool';
    END IF;

    -- Reactivating restores it at the very same position, with no extra action.
    UPDATE ap.render_sponsors SET ativo = true WHERE id = v_target;

    SELECT m.ordem INTO v_ordem_after
    FROM ap.render_sponsor_scope_memberships m
    WHERE m.sponsor_id = v_target AND m.content_type = 'feed';

    IF v_ordem_after IS DISTINCT FROM v_ordem_before THEN
        RAISE EXCEPTION 'ASSERTION: reactivating did not preserve the position';
    END IF;

    SELECT count(*) INTO v_pool_after
    FROM ap.render_sponsor_scope_memberships m
    JOIN ap.render_sponsors s ON s.id = m.sponsor_id AND s.cliente_id = m.cliente_id
    WHERE m.cliente_id = '33333333-3333-4333-8333-333333333333'
      AND m.template_set = 'default' AND m.content_type = 'feed'
      AND m.ativo AND s.ativo;

    IF v_pool_after <> v_pool_before THEN
        RAISE EXCEPTION 'ASSERTION: reactivating did not restore eligibility';
    END IF;
END;
$$;

-- ── The registered catalog feeds the real rotation: TVG 2, Misto 1 ────────
DO $$
DECLARE
    v_base_tvg jsonb := jsonb_build_object(
        'master_config', jsonb_build_object(
            'master_template_uuid', 'mzszfje7xdh6l', 'visual_model', 'tvg'),
        'visual_model', 'tvg',
        'layer_map', '{"headline":"titulo-materia"}'::jsonb);
    v_base_misto jsonb := jsonb_build_object(
        'master_config', jsonb_build_object(
            'master_template_uuid', '3pm4re4blrizh', 'visual_model', 'misto'),
        'visual_model', 'misto',
        'layer_map', '{"headline":"titulo-materia"}'::jsonb);
    v_base_reels jsonb := jsonb_build_object(
        'master_config', jsonb_build_object(
            'master_template_uuid', 'xcxtk9tt7syfd', 'visual_model', 'tvg'),
        'visual_model', 'tvg',
        'layer_map', '{"headline":"titulo-materia"}'::jsonb);
    v_base_story jsonb := jsonb_build_object(
        'master_config', jsonb_build_object(
            'master_template_uuid', 'x3djtbqorrtqc', 'visual_model', 'story'),
        'visual_model', 'story',
        'layer_map', '{"headline":"titulo-materia"}'::jsonb);
    v_feed_index_before integer;
    v_state_formats text[];

    v jsonb;
BEGIN
    v := ap.create_candidate_with_sponsors(
        '33333333-3333-4333-8333-333333333333', gen_random_uuid(),
        'feed', 'default', 2::smallint, 'Materia TVG', 'txt',
        NULL, NULL, 'DESTAQUE', NULL, NULL, 'master_v1', v_base_tvg);
    IF jsonb_array_length(v -> 'sponsor_selection' -> 'items') <> 2 THEN
        RAISE EXCEPTION 'ASSERTION: tvg did not consume two sponsors';
    END IF;

    v := ap.create_candidate_with_sponsors(
        '33333333-3333-4333-8333-333333333333', gen_random_uuid(),
        'feed', 'default', 1::smallint, 'Materia Misto', 'txt',
        NULL, NULL, 'DESTAQUE', NULL, NULL, 'master_v1', v_base_misto);
    IF jsonb_array_length(v -> 'sponsor_selection' -> 'items') <> 1 THEN
        RAISE EXCEPTION 'ASSERTION: misto did not consume one sponsor';
    END IF;
    IF (v #>> '{sponsor_selection,items,0,slot}') <> 'sponsor_1' THEN
        RAISE EXCEPTION 'ASSERTION: the single sponsor did not land in sponsor_1';
    END IF;

    -- Both models drew from the same catalog and the same cursor.
    IF (SELECT count(*) FROM ap.render_sponsor_rotation_state
        WHERE cliente_id = '33333333-3333-4333-8333-333333333333'
          AND content_type = 'feed') <> 1 THEN
        RAISE EXCEPTION 'ASSERTION: tvg and misto did not share one feed cursor';
    END IF;

    SELECT current_index
    INTO v_feed_index_before
    FROM ap.render_sponsor_rotation_state
    WHERE cliente_id = '33333333-3333-4333-8333-333333333333'
      AND template_set = 'default'
      AND content_type = 'feed';

    v := ap.create_candidate_with_sponsors(
        '33333333-3333-4333-8333-333333333333', gen_random_uuid(),
        'reels', 'default', 1::smallint, 'Materia Reels', 'txt',
        NULL, NULL, 'DESTAQUE', NULL, NULL, 'master_v1', v_base_reels);
    IF jsonb_array_length(v -> 'sponsor_selection' -> 'items') <> 1 THEN
        RAISE EXCEPTION 'ASSERTION: reels did not consume its own sponsor';
    END IF;

    v := ap.create_candidate_with_sponsors(
        '33333333-3333-4333-8333-333333333333', gen_random_uuid(),
        'story', 'default', 1::smallint, 'Materia Story', 'txt',
        NULL, NULL, 'DESTAQUE', NULL, NULL, 'master_v1', v_base_story);
    IF jsonb_array_length(v -> 'sponsor_selection' -> 'items') <> 1 THEN
        RAISE EXCEPTION 'ASSERTION: story did not consume its own sponsor';
    END IF;

    SELECT array_agg(content_type ORDER BY content_type)
    INTO v_state_formats
    FROM ap.render_sponsor_rotation_state
    WHERE cliente_id = '33333333-3333-4333-8333-333333333333'
      AND template_set = 'default';

    IF v_state_formats IS DISTINCT FROM ARRAY['feed', 'reels', 'story']::text[] THEN
        RAISE EXCEPTION
            'ASSERTION: rotation states must be independent for feed,reels,story (got %)',
            v_state_formats;
    END IF;

    IF (
        SELECT current_index
        FROM ap.render_sponsor_rotation_state
        WHERE cliente_id = '33333333-3333-4333-8333-333333333333'
          AND template_set = 'default'
          AND content_type = 'feed'
    ) IS DISTINCT FROM v_feed_index_before THEN
        RAISE EXCEPTION 'ASSERTION: reels or story reused the feed rotation state';
    END IF;
END;
$$;

\echo 'render-sponsor-registration.sql: PASS'

ROLLBACK;
