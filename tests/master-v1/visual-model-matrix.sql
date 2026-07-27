-- Certifies the fixed TVG / TVG + IMG matrix directly against the migrated
-- schema: the widened unique key, the four templates, the derived sponsor
-- counts, the shared rotation cursor and the fail-closed pool guard.
-- Self-contained: everything runs inside one transaction and is rolled back.
\set ON_ERROR_STOP on
BEGIN;

\set cliente_id '11111111-1111-4111-8111-111111111111'
\set feed_layers '{"headline":"titulo-materia","news_image":"news-image","visual_title":"titulo-png","sponsor_1":"patrocinador-1","sponsor_2":"patrocinador-2"}'
\set reels_layers '{"headline":"titulo-materia","visual_title":"titulo-png","sponsor_1":"patrocinador-1","sponsor_2":"patrocinador-2"}'

-- Minimal tenant scaffold.
INSERT INTO public.clientes (id, nome)
VALUES (:'cliente_id', 'Tenant matriz visual')
ON CONFLICT (id) DO NOTHING;

-- The producer calls the RPC with a service_role JWT, exactly like the edge
-- function does after it has authorized the caller and the tenant. The RPC
-- gates on the JWT claim, so only the claim has to be present here.
SELECT set_config(
    'request.jwt.claims',
    '{"role":"service_role","sub":"11111111-1111-4111-8111-111111111111"}',
    true
) \gset

-- ── The four fixed templates coexist under the widened unique key ───────────
INSERT INTO ap.master_render_configs
    (cliente_id, content_type, visual_model, master_template_uuid, enabled, layer_map)
VALUES
    (:'cliente_id', 'feed',  'tvg',     'mzszfje7xdh6l', true, :'feed_layers'::jsonb),
    (:'cliente_id', 'feed',  'tvg_img', '3pm4re4blrizh', true, :'feed_layers'::jsonb),
    (:'cliente_id', 'reels', 'tvg',     'xcxtk9tt7syfd', true, :'reels_layers'::jsonb),
    (:'cliente_id', 'reels', 'tvg_img', 'rrbcykdqcrqae', true, :'reels_layers'::jsonb);

DO $$
BEGIN
    IF (SELECT count(*) FROM ap.master_render_configs
        WHERE cliente_id = '11111111-1111-4111-8111-111111111111') <> 4 THEN
        RAISE EXCEPTION 'ASSERTION: expected four masters per tenant';
    END IF;

    -- Two configurations per format is exactly what the matrix requires.
    IF (SELECT count(*) FROM ap.master_render_configs
        WHERE cliente_id = '11111111-1111-4111-8111-111111111111'
          AND content_type = 'feed') <> 2 THEN
        RAISE EXCEPTION 'ASSERTION: expected two feed masters';
    END IF;
END;
$$;

-- ── A duplicate of the same triple is rejected ─────────────────────────────
DO $$
BEGIN
    BEGIN
        INSERT INTO ap.master_render_configs
            (cliente_id, content_type, visual_model, master_template_uuid, enabled, layer_map)
        VALUES
            ('11111111-1111-4111-8111-111111111111', 'feed', 'tvg',
             'duplicate-uuid', true, '{}'::jsonb);
        RAISE EXCEPTION
            'ASSERTION: duplicate (cliente, content_type, visual_model) was accepted';
    EXCEPTION WHEN unique_violation THEN
        NULL; -- expected
    END;
END;
$$;

-- ── An unknown visual model is rejected by the CHECK ────────────────────────
-- 'misto' is included on purpose: after the 20260727120000 rename it is no
-- longer a storable master slug, it survives only inside frozen snapshots.
DO $$
DECLARE
    v_retired text;
BEGIN
    FOREACH v_retired IN ARRAY ARRAY['itumbiara', 'misto'] LOOP
        BEGIN
            INSERT INTO ap.master_render_configs
                (cliente_id, content_type, visual_model, master_template_uuid, enabled, layer_map)
            VALUES
                ('11111111-1111-4111-8111-111111111111', 'feed', v_retired,
                 'removed-model', true, '{}'::jsonb);
            RAISE EXCEPTION
                'ASSERTION: visual_model % outside (tvg, tvg_img) was accepted',
                v_retired;
        EXCEPTION WHEN check_violation THEN
            NULL; -- expected
        END;
    END LOOP;
END;
$$;

-- ── Matrix resolution: each pair addresses exactly one fixed template ───────
DO $$
DECLARE
    v_expected jsonb := '{
        "feed/tvg": "mzszfje7xdh6l",
        "reels/tvg": "xcxtk9tt7syfd",
        "feed/tvg_img": "3pm4re4blrizh",
        "reels/tvg_img": "rrbcykdqcrqae"
    }'::jsonb;
    v_key text;
    v_uuid text;
BEGIN
    FOR v_key IN SELECT jsonb_object_keys(v_expected) LOOP
        SELECT master_template_uuid INTO v_uuid
        FROM ap.master_render_configs
        WHERE cliente_id = '11111111-1111-4111-8111-111111111111'
          AND content_type = split_part(v_key, '/', 1)
          AND visual_model = split_part(v_key, '/', 2)
          AND enabled;

        IF v_uuid IS DISTINCT FROM (v_expected ->> v_key) THEN
            RAISE EXCEPTION
                'ASSERTION: % resolved % instead of %',
                v_key, v_uuid, v_expected ->> v_key;
        END IF;
    END LOOP;
END;
$$;

-- ── Sponsor catalog: registered once, shared by both visual models ──────────
INSERT INTO ap.render_sponsors
    (id, cliente_id, nome, slug, asset_bucket, asset_path, asset_version, sha256)
VALUES
    ('22222222-2222-4222-8222-00000000000a', :'cliente_id', 'Sponsor A', 'sponsor-a',
     'ap-images', 'sponsors/a.png', 'v1', repeat('a', 64)),
    ('22222222-2222-4222-8222-00000000000b', :'cliente_id', 'Sponsor B', 'sponsor-b',
     'ap-images', 'sponsors/b.png', 'v1', repeat('b', 64)),
    ('22222222-2222-4222-8222-00000000000c', :'cliente_id', 'Sponsor C', 'sponsor-c',
     'ap-images', 'sponsors/c.png', 'v1', repeat('c', 64));

-- One membership per sponsor per format: template_set is the fixed shared scope.
INSERT INTO ap.render_sponsor_scope_memberships
    (sponsor_id, cliente_id, template_set, content_type, ordem)
VALUES
    ('22222222-2222-4222-8222-00000000000a', :'cliente_id', 'default', 'feed', 0),
    ('22222222-2222-4222-8222-00000000000b', :'cliente_id', 'default', 'feed', 1),
    ('22222222-2222-4222-8222-00000000000c', :'cliente_id', 'default', 'feed', 2);

-- ── TVG takes two, TVG + IMG takes one, from one shared cursor ─────────────────
DO $$
DECLARE
    v_result jsonb;
    v_items jsonb;
    v_base jsonb;
BEGIN
    -- TVG feed → sponsors A and B.
    v_base := jsonb_build_object(
        'master_config', jsonb_build_object(
            'master_template_uuid', 'mzszfje7xdh6l', 'visual_model', 'tvg'),
        'visual_model', 'tvg',
        'layer_map', '{"headline":"titulo-materia"}'::jsonb);
    v_result := ap.create_candidate_with_sponsors(
        '11111111-1111-4111-8111-111111111111',
        gen_random_uuid(), 'feed', 'default', 2::smallint,
        'Materia TVG', 'conteudo', NULL, NULL, 'DESTAQUE', NULL, NULL,
        'master_v1', v_base);
    v_items := v_result -> 'sponsor_selection' -> 'items';

    IF jsonb_array_length(v_items) <> 2 THEN
        RAISE EXCEPTION 'ASSERTION: tvg must select two sponsors';
    END IF;
    IF (v_items -> 0 ->> 'slot') <> 'sponsor_1'
       OR (v_items -> 1 ->> 'slot') <> 'sponsor_2' THEN
        RAISE EXCEPTION 'ASSERTION: tvg slots must be sponsor_1 then sponsor_2';
    END IF;
    IF (v_items -> 0 ->> 'name') <> 'Sponsor A'
       OR (v_items -> 1 ->> 'name') <> 'Sponsor B' THEN
        RAISE EXCEPTION 'ASSERTION: tvg must take the first two of the cursor';
    END IF;
    -- master_v1 must not consume the legacy template queue.
    IF (v_result -> 'template' ->> 'legacy_placid_template_uuid')
       <> 'mzszfje7xdh6l' THEN
        RAISE EXCEPTION 'ASSERTION: master_v1 must anchor the legacy uuid to the master';
    END IF;

    -- TVG + IMG feed → sponsor C only, continuing the SAME cursor.
    v_base := jsonb_build_object(
        'master_config', jsonb_build_object(
            'master_template_uuid', '3pm4re4blrizh', 'visual_model', 'tvg_img'),
        'visual_model', 'tvg_img',
        'layer_map', '{"headline":"titulo-materia"}'::jsonb);
    v_result := ap.create_candidate_with_sponsors(
        '11111111-1111-4111-8111-111111111111',
        gen_random_uuid(), 'feed', 'default', 1::smallint,
        'Materia TVG IMG', 'conteudo', NULL, NULL, 'DESTAQUE', NULL, NULL,
        'master_v1', v_base);
    v_items := v_result -> 'sponsor_selection' -> 'items';

    IF jsonb_array_length(v_items) <> 1 THEN
        RAISE EXCEPTION 'ASSERTION: tvg_img must select exactly one sponsor';
    END IF;
    IF (v_items -> 0 ->> 'slot') <> 'sponsor_1' THEN
        RAISE EXCEPTION 'ASSERTION: the single sponsor must land in sponsor_1';
    END IF;
    IF (v_items -> 0 ->> 'name') <> 'Sponsor C' THEN
        RAISE EXCEPTION
            'ASSERTION: tvg_img must continue the shared cursor (expected Sponsor C)';
    END IF;

    -- TVG again → wraps back to A and B, proving one shared cursor per format.
    v_base := jsonb_build_object(
        'master_config', jsonb_build_object(
            'master_template_uuid', 'mzszfje7xdh6l', 'visual_model', 'tvg'),
        'visual_model', 'tvg',
        'layer_map', '{"headline":"titulo-materia"}'::jsonb);
    v_result := ap.create_candidate_with_sponsors(
        '11111111-1111-4111-8111-111111111111',
        gen_random_uuid(), 'feed', 'default', 2::smallint,
        'Materia TVG 2', 'conteudo', NULL, NULL, 'DESTAQUE', NULL, NULL,
        'master_v1', v_base);
    v_items := v_result -> 'sponsor_selection' -> 'items';

    IF (v_items -> 0 ->> 'name') <> 'Sponsor A'
       OR (v_items -> 1 ->> 'name') <> 'Sponsor B' THEN
        RAISE EXCEPTION
            'ASSERTION: the shared cursor must wrap around to Sponsor A/B';
    END IF;
END;
$$;

-- ── Fail closed when the pool cannot satisfy the derived count ──────────────
DO $$
DECLARE
    v_base jsonb := jsonb_build_object(
        'master_config', jsonb_build_object(
            'master_template_uuid', 'xcxtk9tt7syfd', 'visual_model', 'tvg'),
        'visual_model', 'tvg',
        'layer_map', '{"headline":"titulo-materia"}'::jsonb);
BEGIN
    -- Reels has a single active sponsor: TVG needs two and must abort.
    INSERT INTO ap.render_sponsor_scope_memberships
        (sponsor_id, cliente_id, template_set, content_type, ordem)
    VALUES
        ('22222222-2222-4222-8222-00000000000a',
         '11111111-1111-4111-8111-111111111111', 'default', 'reels', 0);

    BEGIN
        PERFORM ap.create_candidate_with_sponsors(
            '11111111-1111-4111-8111-111111111111',
            gen_random_uuid(), 'reels', 'default', 2::smallint,
            'Materia TVG reels', 'conteudo', NULL, NULL, 'DESTAQUE', NULL, NULL,
            'master_v1', v_base);
        RAISE EXCEPTION
            'ASSERTION: tvg with a single active sponsor must fail closed';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM NOT LIKE 'SPONSOR_POOL_INSUFFICIENT%' THEN
            RAISE;
        END IF;
    END;
END;
$$;

-- ── TVG + IMG with an empty pool also fails closed ─────────────────────────────
DO $$
DECLARE
    v_base jsonb := jsonb_build_object(
        'master_config', jsonb_build_object(
            'master_template_uuid', 'rrbcykdqcrqae', 'visual_model', 'tvg_img'),
        'visual_model', 'tvg_img',
        'layer_map', '{"headline":"titulo-materia"}'::jsonb);
BEGIN
    UPDATE ap.render_sponsor_scope_memberships
    SET ativo = false
    WHERE cliente_id = '11111111-1111-4111-8111-111111111111'
      AND content_type = 'reels';

    BEGIN
        PERFORM ap.create_candidate_with_sponsors(
            '11111111-1111-4111-8111-111111111111',
            gen_random_uuid(), 'reels', 'default', 1::smallint,
            'Materia TVG IMG reels', 'conteudo', NULL, NULL, 'DESTAQUE', NULL, NULL,
            'master_v1', v_base);
        RAISE EXCEPTION 'ASSERTION: tvg_img without an active sponsor must fail closed';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM NOT LIKE 'SPONSOR_POOL_INSUFFICIENT%' THEN
            RAISE;
        END IF;
    END;
END;
$$;

-- ── The rotation scope stayed model-agnostic ───────────────────────────────
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM ap.render_sponsor_rotation_state
        WHERE cliente_id = '11111111-1111-4111-8111-111111111111'
          AND template_set <> 'default'
    ) THEN
        RAISE EXCEPTION 'ASSERTION: rotation state must stay on the shared scope';
    END IF;

    -- One cursor per format, never one per visual model.
    IF (SELECT count(*) FROM ap.render_sponsor_rotation_state
        WHERE cliente_id = '11111111-1111-4111-8111-111111111111'
          AND content_type = 'feed') <> 1 THEN
        RAISE EXCEPTION 'ASSERTION: feed must have exactly one shared cursor';
    END IF;
END;
$$;

\echo 'visual-model-matrix.sql: PASS'

ROLLBACK;
