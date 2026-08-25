\set ON_ERROR_STOP on

-- Transactional certification for territorial_composer_v1. All fixtures are
-- local-only and rolled back at the end.
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.assert_true(
    p_condition boolean,
    p_message text
)
RETURNS void
LANGUAGE plpgsql
AS $function$
BEGIN
    IF NOT COALESCE(p_condition, false) THEN
        RAISE EXCEPTION 'ASSERTION_FAILED: %', p_message;
    END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION pg_temp.assert_raises(
    p_sql text,
    p_expected_state text,
    p_message text
)
RETURNS void
LANGUAGE plpgsql
AS $function$
DECLARE
    v_raised boolean := false;
BEGIN
    BEGIN
        EXECUTE p_sql;
    EXCEPTION WHEN OTHERS THEN
        v_raised := true;
        IF SQLSTATE <> p_expected_state THEN
            RAISE EXCEPTION
                'ASSERTION_FAILED: %, got SQLSTATE %, expected %',
                p_message,
                SQLSTATE,
                p_expected_state;
        END IF;
    END;
    IF NOT v_raised THEN
        RAISE EXCEPTION 'ASSERTION_FAILED: %', p_message;
    END IF;
END;
$function$;

CREATE TEMP TABLE composer_results (
    key text PRIMARY KEY,
    value jsonb NOT NULL
);

INSERT INTO public.clientes (id, nome)
VALUES
    ('c1000000-0000-4000-8000-000000000001', 'Composer Tenant A'),
    ('d1000000-0000-4000-8000-000000000002', 'Composer Tenant B');

INSERT INTO auth.users (id, email)
VALUES
    ('c2000000-0000-4000-8000-000000000001', 'composer-a@example.test'),
    ('d2000000-0000-4000-8000-000000000002', 'composer-b@example.test');

INSERT INTO public.cliente_profissionais (
    cliente_id,
    profissional_id,
    funcao,
    ativo
)
VALUES
    (
        'c1000000-0000-4000-8000-000000000001',
        'c2000000-0000-4000-8000-000000000001',
        'editor',
        true
    ),
    (
        'd1000000-0000-4000-8000-000000000002',
        'd2000000-0000-4000-8000-000000000002',
        'editor',
        true
    );

INSERT INTO ap.territorial_composer_features (cliente_id, enabled)
VALUES
    ('c1000000-0000-4000-8000-000000000001', true),
    ('d1000000-0000-4000-8000-000000000002', false);

INSERT INTO ap.visual_title_groups (
    id,
    cliente_id,
    nome,
    slug,
    ordem,
    ativo
)
VALUES
    (
        'c3000000-0000-4000-8000-000000000001',
        'c1000000-0000-4000-8000-000000000001',
        'EDITORIAL',
        'editorial',
        0,
        true
    ),
    (
        'c3000000-0000-4000-8000-000000000002',
        'c1000000-0000-4000-8000-000000000001',
        'CIDADES',
        'cidades',
        1,
        true
    ),
    (
        'd3000000-0000-4000-8000-000000000001',
        'd1000000-0000-4000-8000-000000000002',
        'EDITORIAL',
        'editorial',
        0,
        true
    );

INSERT INTO ap.visual_titles (
    id,
    cliente_id,
    group_id,
    nome,
    slug,
    asset_bucket,
    asset_path,
    asset_version,
    sha256,
    ativo,
    ordem,
    formatos,
    tipo
)
VALUES
    (
        'c4000000-0000-4000-8000-000000000001',
        'c1000000-0000-4000-8000-000000000001',
        'c3000000-0000-4000-8000-000000000001',
        'Editorial A',
        'editorial-a',
        'ap-images',
        'visual-titles/c1000000-0000-4000-8000-000000000001/editorial-a.png',
        'editorial-v1',
        repeat('1', 64),
        true,
        0,
        ARRAY['feed', 'reels']::text[],
        'editorial'
    ),
    (
        'c4000000-0000-4000-8000-000000000002',
        'c1000000-0000-4000-8000-000000000001',
        'c3000000-0000-4000-8000-000000000002',
        'Cidade A',
        'cidade-a',
        'ap-images',
        'cities/c1000000-0000-4000-8000-000000000001/cidade-a.png',
        'city-v1',
        repeat('2', 64),
        true,
        1,
        ARRAY['feed', 'reels']::text[],
        'cidade'
    ),
    (
        'd4000000-0000-4000-8000-000000000001',
        'd1000000-0000-4000-8000-000000000002',
        'd3000000-0000-4000-8000-000000000001',
        'Foreign Editorial',
        'foreign-editorial',
        'ap-images',
        'visual-titles/d1000000-0000-4000-8000-000000000002/editorial.png',
        'foreign-v1',
        repeat('3', 64),
        true,
        0,
        ARRAY['feed', 'reels']::text[],
        'editorial'
    );

INSERT INTO ap.territorial_regions (
    id,
    cliente_id,
    nome,
    slug,
    asset_bucket,
    asset_path,
    asset_version,
    sha256,
    ativo
)
VALUES
    (
        'c5000000-0000-4000-8000-000000000001',
        'c1000000-0000-4000-8000-000000000001',
        'Regiao A',
        'regiao-a',
        'ap-images',
        'regions/c1000000-0000-4000-8000-000000000001/regiao-a.png',
        'region-v1',
        repeat('4', 64),
        true
    ),
    (
        'c5000000-0000-4000-8000-000000000002',
        'c1000000-0000-4000-8000-000000000001',
        'Regiao B',
        'regiao-b',
        'ap-images',
        'regions/c1000000-0000-4000-8000-000000000001/regiao-b.png',
        'region-v1',
        repeat('5', 64),
        true
    ),
    (
        'd5000000-0000-4000-8000-000000000001',
        'd1000000-0000-4000-8000-000000000002',
        'Foreign Region',
        'foreign-region',
        'ap-images',
        'regions/d1000000-0000-4000-8000-000000000002/foreign.png',
        'region-v1',
        repeat('6', 64),
        true
    );

INSERT INTO ap.territorial_cities (
    id,
    cliente_id,
    region_id,
    nome,
    slug,
    asset_bucket,
    asset_path,
    asset_version,
    sha256,
    visual_title_id,
    ativo
)
VALUES (
    'c6000000-0000-4000-8000-000000000001',
    'c1000000-0000-4000-8000-000000000001',
    'c5000000-0000-4000-8000-000000000001',
    'Cidade A',
    'cidade-a',
    'ap-images',
    'cities/c1000000-0000-4000-8000-000000000001/cidade-a.png',
    'city-v1',
    repeat('2', 64),
    'c4000000-0000-4000-8000-000000000002',
    true
);

INSERT INTO ap.render_sponsors (
    id,
    cliente_id,
    nome,
    slug,
    asset_bucket,
    asset_path,
    asset_version,
    sha256,
    ativo,
    created_at
)
SELECT
    (
        'c7' || lpad(sequence::text, 6, '0')
        || '-0000-4000-8000-'
        || lpad(sequence::text, 12, '0')
    )::uuid,
    'c1000000-0000-4000-8000-000000000001'::uuid,
    'Sponsor ' || sequence,
    'sponsor-' || sequence,
    'ap-images',
    'sponsors/c1000000-0000-4000-8000-000000000001/sponsor-' || sequence || '.png',
    'sponsor-v1',
    repeat(to_hex(sequence), 64),
    true,
    '2026-08-04 12:00:00+00'::timestamptz + (sequence || ' seconds')::interval
FROM generate_series(1, 5) AS sequence;

INSERT INTO ap.territorial_region_sponsors (
    cliente_id,
    region_id,
    sponsor_id,
    ativo,
    created_at
)
SELECT
    sponsor.cliente_id,
    'c5000000-0000-4000-8000-000000000001'::uuid,
    sponsor.id,
    true,
    sponsor.created_at
FROM ap.render_sponsors AS sponsor
WHERE sponsor.cliente_id = 'c1000000-0000-4000-8000-000000000001';

INSERT INTO ap.territorial_composer_templates (
    cliente_id,
    content_type,
    master_template_uuid,
    layer_map,
    ativo
)
VALUES
    (
        'c1000000-0000-4000-8000-000000000001',
        'feed',
        'composer_feed_local',
        '{
            "headline":"titulo-materia",
            "news_image":"news-image",
            "visual_title":"titulo-png",
            "footer_slot_1":"regiao-1",
            "footer_slot_2":"patrocinador-1",
            "footer_slot_3":"patrocinador-2"
        }'::jsonb,
        true
    ),
    (
        'c1000000-0000-4000-8000-000000000001',
        'reels',
        'composer_reels_local',
        '{
            "headline":"titulo-materia",
            "visual_title":"titulo-png",
            "footer_slot_1":"regiao-1",
            "footer_slot_2":"patrocinador-1",
            "footer_slot_3":"patrocinador-2"
        }'::jsonb,
        true
    ),
    (
        'c1000000-0000-4000-8000-000000000001',
        'story',
        'composer_story_local',
        '{
            "footer_slot_1":"regiao-1",
            "footer_slot_2":"patrocinador-1",
            "footer_slot_3":"patrocinador-2"
        }'::jsonb,
        true
    );

-- A foreign tenant can own a valid but deliberately distinct physical map.
-- Tenant A must never freeze this row into its snapshot.
INSERT INTO ap.territorial_composer_templates (
    cliente_id,
    content_type,
    master_template_uuid,
    layer_map,
    ativo
) VALUES (
    'd1000000-0000-4000-8000-000000000002',
    'feed',
    'foreign_feed_template',
    '{"headline":"foreign-headline","news_image":"foreign-image","visual_title":"foreign-title","footer_slot_1":"foreign-slot-1","footer_slot_2":"foreign-slot-2","footer_slot_3":"foreign-slot-3"}'::jsonb,
    true
);

SELECT set_config(
    'request.jwt.claims',
    '{"role":"authenticated","sub":"c2000000-0000-4000-8000-000000000001"}',
    true
);

SELECT pg_temp.assert_true(
    (
        SELECT
            jsonb_array_length(catalog -> 'available_formats') = 3
            AND jsonb_array_length(catalog -> 'cities') = 1
            AND jsonb_array_length(catalog -> 'regions') = 2
        FROM (
            SELECT ap.get_territorial_composer_catalog(
                'c1000000-0000-4000-8000-000000000001'
            ) AS catalog
        ) AS result
    ),
    'catalog did not expose only active same-tenant composer data'
);

-- Automatic composition fails closed below two sponsors and certifies the
-- exact cycle shape for pools with two through four sponsors.
INSERT INTO ap.territorial_regions (
    id,
    cliente_id,
    nome,
    slug,
    asset_bucket,
    asset_path,
    asset_version,
    sha256,
    ativo
)
SELECT
    (
        'c5' || lpad((pool_size + 3)::text, 6, '0')
        || '-0000-4000-8000-'
        || lpad((pool_size + 3)::text, 12, '0')
    )::uuid,
    'c1000000-0000-4000-8000-000000000001'::uuid,
    'Pool Region ' || pool_size,
    'pool-region-' || pool_size,
    'ap-images',
    'regions/c1000000-0000-4000-8000-000000000001/pool-' || pool_size || '.png',
    'pool-region-v1',
    repeat(to_hex(pool_size + 1), 64),
    true
FROM generate_series(0, 4) AS pool_size;

INSERT INTO ap.territorial_region_sponsors (
    cliente_id,
    region_id,
    sponsor_id,
    ativo,
    created_at
)
SELECT
    sponsor.cliente_id,
    (
        'c5' || lpad((pool.pool_size + 3)::text, 6, '0')
        || '-0000-4000-8000-'
        || lpad((pool.pool_size + 3)::text, 12, '0')
    )::uuid,
    sponsor.id,
    true,
    sponsor.created_at
FROM generate_series(1, 4) AS pool(pool_size)
JOIN LATERAL (
    SELECT available.*
    FROM ap.render_sponsors AS available
    WHERE available.cliente_id = 'c1000000-0000-4000-8000-000000000001'
    ORDER BY available.created_at, available.id
    LIMIT pool.pool_size
) AS sponsor ON true;

SELECT pg_temp.assert_raises(
    $sql$
        SELECT ap.create_territorial_composer_candidate(
            'c1000000-0000-4000-8000-000000000001',
            gen_random_uuid(),
            'feed',
            'editorial',
            'Pool zero headline',
            'Pool body text',
            NULL,
            'https://local.test/source.png',
            'DESTAQUE',
            'c5000003-0000-4000-8000-000000000003',
            NULL,
            'c4000000-0000-4000-8000-000000000001',
            '[]'::jsonb
        )
    $sql$,
    '23514',
    'zero-sponsor automatic pool did not fail closed'
);

SELECT pg_temp.assert_raises(
    $sql$
        SELECT ap.create_territorial_composer_candidate(
            'c1000000-0000-4000-8000-000000000001',
            gen_random_uuid(),
            'feed',
            'editorial',
            'Pool one headline',
            'Pool body text',
            NULL,
            'https://local.test/source.png',
            'DESTAQUE',
            'c5000004-0000-4000-8000-000000000004',
            NULL,
            'c4000000-0000-4000-8000-000000000001',
            '[]'::jsonb
        )
    $sql$,
    '23514',
    'one-sponsor automatic pool did not fail closed'
);

INSERT INTO composer_results (key, value)
SELECT
    'pool_' || pool.pool_size || '_' || attempt.attempt,
    ap.create_territorial_composer_candidate(
        'c1000000-0000-4000-8000-000000000001',
        gen_random_uuid(),
        'feed',
        'editorial',
        'Pool headline ' || pool.pool_size || ' ' || attempt.attempt,
        'Pool body text',
        NULL,
        'https://local.test/source.png',
        'DESTAQUE',
        (
            'c5' || lpad((pool.pool_size + 3)::text, 6, '0')
            || '-0000-4000-8000-'
            || lpad((pool.pool_size + 3)::text, 12, '0')
        )::uuid,
        NULL,
        'c4000000-0000-4000-8000-000000000001',
        '[]'::jsonb
    )
FROM generate_series(2, 4) AS pool(pool_size)
CROSS JOIN LATERAL generate_series(
    1,
    CASE
        WHEN pool.pool_size = 0 THEN 1
        WHEN pool.pool_size <= 2 THEN 2
        ELSE 3
    END
) AS attempt(attempt);

SELECT pg_temp.assert_true(
    (
        SELECT
            value #>> '{candidate_news,render_snapshot,template,master_template_uuid}'
                = 'composer_feed_local'
            AND value #>> '{candidate_news,render_snapshot,layer_map,footer_slot_3}'
                = 'patrocinador-2'
        FROM composer_results
        WHERE key = 'pool_2_1'
    ),
    'tenant A snapshot selected a foreign-tenant template or layer map'
);

SELECT pg_temp.assert_true(
    (
        SELECT array_agg(
            jsonb_array_length(value #> '{candidate_news,render_snapshot,sponsor_selection,items}')
            ORDER BY key
        ) = ARRAY[2, 2]
        FROM composer_results
        WHERE key LIKE 'pool_2_%'
    ),
    'two-sponsor pool did not reserve both sponsors per cycle'
);
SELECT pg_temp.assert_true(
    (
        SELECT array_agg(
            jsonb_array_length(value #> '{candidate_news,render_snapshot,sponsor_selection,items}')
            ORDER BY key
        ) = ARRAY[2, 2, 2]
        FROM composer_results
        WHERE key LIKE 'pool_3_%'
    ),
    'three-sponsor pool emitted an incomplete automatic pair'
);
SELECT pg_temp.assert_true(
    (
        SELECT array_agg(
            jsonb_array_length(value #> '{candidate_news,render_snapshot,sponsor_selection,items}')
            ORDER BY key
        ) = ARRAY[2, 2, 2]
        FROM composer_results
        WHERE key LIKE 'pool_4_%'
    ),
    'four-sponsor pool did not reserve 2,2,2'
);

-- A newly associated sponsor joins the remaining current-cycle sponsor.
INSERT INTO ap.territorial_region_sponsors (
    cliente_id,
    region_id,
    sponsor_id,
    ativo,
    created_at
)
VALUES (
    'c1000000-0000-4000-8000-000000000001',
    'c5000006-0000-4000-8000-000000000006',
    'c7000004-0000-4000-8000-000000000004',
    true,
    '2026-08-04 12:00:10+00'
);
INSERT INTO composer_results (key, value)
VALUES (
    'pool_3_new_tail',
    ap.create_territorial_composer_candidate(
        'c1000000-0000-4000-8000-000000000001',
        gen_random_uuid(),
        'feed',
        'editorial',
        'New sponsor tail',
        'Pool body text',
        NULL,
        'https://local.test/source.png',
        'DESTAQUE',
        'c5000006-0000-4000-8000-000000000006',
        NULL,
        'c4000000-0000-4000-8000-000000000001',
        '[]'::jsonb
    )
);
SELECT pg_temp.assert_true(
    (
        SELECT ARRAY(
            SELECT item ->> 'sponsor_id'
            FROM jsonb_array_elements(
                value #> '{candidate_news,render_snapshot,sponsor_selection,items}'
            ) AS item
        ) = ARRAY[
            'c7000001-0000-4000-8000-000000000001',
            'c7000004-0000-4000-8000-000000000004'
        ]
        FROM composer_results
        WHERE key = 'pool_3_new_tail'
    ),
    'new sponsor did not join the end of the current cycle'
);

-- General deactivation fails closed when fewer than two sponsors remain.
UPDATE ap.render_sponsors
SET ativo = false
WHERE id = 'c7000002-0000-4000-8000-000000000002';
SELECT pg_temp.assert_raises(
    $sql$
        SELECT ap.create_territorial_composer_candidate(
            'c1000000-0000-4000-8000-000000000001',
            gen_random_uuid(),
            'feed',
            'editorial',
            'Sponsor deactivated',
            'Pool body text',
            NULL,
            'https://local.test/source.png',
            'DESTAQUE',
            'c5000005-0000-4000-8000-000000000005',
            NULL,
            'c4000000-0000-4000-8000-000000000001',
            '[]'::jsonb
        )
    $sql$,
    '23514',
    'one remaining active sponsor did not fail closed'
);
UPDATE ap.render_sponsors
SET ativo = true
WHERE id = 'c7000002-0000-4000-8000-000000000002';

-- Removing one regional association affects only that region.
UPDATE ap.territorial_region_sponsors
SET ativo = false,
    removed_at = now()
WHERE region_id = 'c5000007-0000-4000-8000-000000000007'
  AND sponsor_id = 'c7000003-0000-4000-8000-000000000003';
INSERT INTO composer_results (key, value)
VALUES (
    'pool_4_after_removal',
    ap.create_territorial_composer_candidate(
        'c1000000-0000-4000-8000-000000000001',
        gen_random_uuid(),
        'feed',
        'editorial',
        'Regional sponsor removed',
        'Pool body text',
        NULL,
        'https://local.test/source.png',
        'DESTAQUE',
        'c5000007-0000-4000-8000-000000000007',
        NULL,
        'c4000000-0000-4000-8000-000000000001',
        '[]'::jsonb
    )
);
SELECT pg_temp.assert_true(
    (
        SELECT
            jsonb_array_length(
                value #> '{candidate_news,render_snapshot,sponsor_selection,items}'
            ) = 2
            AND ARRAY(
                SELECT item ->> 'sponsor_id'
                FROM jsonb_array_elements(
                    value #> '{candidate_news,render_snapshot,sponsor_selection,items}'
                ) AS item
            ) = ARRAY[
                'c7000004-0000-4000-8000-000000000004',
                'c7000001-0000-4000-8000-000000000001'
            ]
        FROM composer_results
        WHERE key = 'pool_4_after_removal'
    )
    AND EXISTS (
        SELECT 1
        FROM ap.territorial_region_sponsors
        WHERE region_id = 'c5000006-0000-4000-8000-000000000006'
          AND sponsor_id = 'c7000003-0000-4000-8000-000000000003'
          AND ativo
    ),
    'regional removal affected another region or retained the removed sponsor'
);

-- With five sponsors, the lone remainder crosses the boundary as a pair.
INSERT INTO composer_results (key, value)
SELECT
    'feed_' || sequence,
    ap.create_territorial_composer_candidate(
        'c1000000-0000-4000-8000-000000000001',
        (
            'ca' || lpad(sequence::text, 6, '0')
            || '-0000-4000-8000-'
            || lpad(sequence::text, 12, '0')
        )::uuid,
        'feed',
        CASE WHEN sequence = 2 THEN 'cities' ELSE 'editorial' END,
        'Headline ' || sequence,
        'Body ' || sequence,
        NULL,
        'https://local.test/source.png',
        'DESTAQUE',
        CASE
            WHEN sequence = 2 THEN NULL
            ELSE 'c5000000-0000-4000-8000-000000000001'::uuid
        END,
        CASE
            WHEN sequence = 2
                THEN 'c6000000-0000-4000-8000-000000000001'::uuid
            ELSE NULL
        END,
        CASE
            WHEN sequence = 2 THEN NULL
            ELSE 'c4000000-0000-4000-8000-000000000001'::uuid
        END,
        '[]'::jsonb
    )
FROM generate_series(1, 4) AS sequence;

SELECT pg_temp.assert_true(
    (
        SELECT array_agg(
            jsonb_array_length(
                value #> '{candidate_news,render_snapshot,sponsor_selection,items}'
            )
            ORDER BY key
        ) = ARRAY[2, 2, 2, 2]
        FROM composer_results
        WHERE key LIKE 'feed_%'
    ),
    'five-sponsor cycle emitted an incomplete automatic pair'
);

SELECT pg_temp.assert_true(
    (
        SELECT
            (feed_one.value #>> '{candidate_news,render_snapshot,sponsor_selection,cycle}')
                =
            (feed_two.value #>> '{candidate_news,render_snapshot,sponsor_selection,cycle}')
        FROM composer_results AS feed_one
        CROSS JOIN composer_results AS feed_two
        WHERE feed_one.key = 'feed_1'
          AND feed_two.key = 'feed_2'
    ),
    'Editorial and Cities did not share the region plus format cycle'
);

-- Reels and Stories own independent rotation states.
INSERT INTO composer_results (key, value)
VALUES
    (
        'reels_1',
        ap.create_territorial_composer_candidate(
            'c1000000-0000-4000-8000-000000000001',
            'cb000001-0000-4000-8000-000000000001',
            'reels',
            'editorial',
            'Reels',
            'Body text',
            NULL,
            NULL,
            'DESTAQUE',
            'c5000000-0000-4000-8000-000000000001',
            NULL,
            'c4000000-0000-4000-8000-000000000001',
            '[]'::jsonb
        )
    ),
    (
        'story_1',
        ap.create_territorial_composer_candidate(
            'c1000000-0000-4000-8000-000000000001',
            'cc000001-0000-4000-8000-000000000001',
            'story',
            'editorial',
            'Story',
            'Body text',
            NULL,
            NULL,
            'DESTAQUE',
            'c5000000-0000-4000-8000-000000000001',
            NULL,
            'c4000000-0000-4000-8000-000000000001',
            '[]'::jsonb
        )
    );

SELECT pg_temp.assert_true(
    (
        SELECT count(*) = 3
        FROM ap.territorial_sponsor_rotation_state
        WHERE cliente_id = 'c1000000-0000-4000-8000-000000000001'
          AND region_id = 'c5000000-0000-4000-8000-000000000001'
    ),
    'Feed, Reels and Stories rotation states were not independent'
);

SELECT pg_temp.assert_true(
    (
        SELECT NOT (value #> '{candidate_news,render_snapshot,layer_map}' ? 'visual_title')
        FROM composer_results
        WHERE key = 'story_1'
    ),
    'Story snapshot retained a visual title layer'
);

-- Individual preserves fixed slot positions and Story does not require a seal.
INSERT INTO composer_results (key, value)
VALUES (
    'story_individual',
    ap.create_territorial_composer_candidate(
        'c1000000-0000-4000-8000-000000000001',
        'cd000001-0000-4000-8000-000000000001',
        'story',
        'individual',
        'Story Individual',
        'Body text',
        NULL,
        NULL,
        'DESTAQUE',
        NULL,
        NULL,
        NULL,
        '[
            {
                "slot":"footer_slot_3",
                "source_type":"region",
                "source_id":"c5000000-0000-4000-8000-000000000002"
            }
        ]'::jsonb
    )
);

SELECT pg_temp.assert_true(
    (
        SELECT
            value #>> '{candidate_news,render_snapshot,footer_slots,0,slot}'
                = 'footer_slot_3'
            AND value #> '{candidate_news,render_snapshot,visual_title}'
                = 'null'::jsonb
        FROM composer_results
        WHERE key = 'story_individual'
    ),
    'Story Individual reordered its slot or required a visual title'
);

-- Idempotency reuses the same candidate and reservation.
SELECT pg_temp.assert_true(
    (
        SELECT
            retry ->> 'reused' = 'true'
            AND retry #>> '{candidate_news,id}'
                = original.value #>> '{candidate_news,id}'
            AND retry ->> 'reservation_id'
                = original.value ->> 'reservation_id'
        FROM composer_results AS original
        CROSS JOIN LATERAL (
            SELECT ap.create_territorial_composer_candidate(
                'c1000000-0000-4000-8000-000000000001',
                'ca000001-0000-4000-8000-000000000001',
                'feed',
                'editorial',
                'Headline 1',
                'Body 1',
                NULL,
                'https://local.test/source.png',
                'DESTAQUE',
                'c5000000-0000-4000-8000-000000000001',
                NULL,
                'c4000000-0000-4000-8000-000000000001',
                '[]'::jsonb
            ) AS retry
        ) AS reused
        WHERE original.key = 'feed_1'
    ),
    'idempotent retry did not reuse the frozen candidate'
);

-- Final editorial content is frozen before rendering; later row mutations do
-- not rewrite the render contract.
SELECT ap.finalize_territorial_composer_candidate(
    (SELECT (value #>> '{candidate_news,id}')::uuid
     FROM composer_results WHERE key = 'feed_1'),
    'Frozen final headline',
    'Frozen caption',
    'DESTAQUE',
    '{"slides":[]}'::jsonb
);
SELECT pg_temp.assert_true(
    (
        SELECT
            status = 'pending_render'
            AND render_snapshot #>> '{render_content,headline}'
                = 'Frozen final headline'
            AND render_snapshot #>> '{render_content,source_image_url}'
                = 'https://local.test/source.png'
        FROM ap.candidate_news
        WHERE id = (
            SELECT (value #>> '{candidate_news,id}')::uuid
            FROM composer_results
            WHERE key = 'feed_1'
        )
    ),
    'final editorial output was not frozen into the render snapshot'
);
UPDATE ap.candidate_news
SET headline = 'Mutated live headline',
    context_tag = 'MUTATED',
    imagem_url = 'https://local.test/mutated.png'
WHERE id = (
    SELECT (value #>> '{candidate_news,id}')::uuid
    FROM composer_results
    WHERE key = 'feed_1'
);

-- Failure releases, retry re-reserves the same frozen selection, success
-- commits without changing the snapshot.
SELECT ap.fail_territorial_composer_render(
    (SELECT (value #>> '{candidate_news,id}')::uuid
     FROM composer_results WHERE key = 'feed_1'),
    'PLACID_REQUEST_FAILED'
);
SELECT pg_temp.assert_true(
    (
        SELECT status = 'released'
        FROM ap.territorial_sponsor_reservations
        WHERE candidate_id = (
            SELECT (value #>> '{candidate_news,id}')::uuid
            FROM composer_results
            WHERE key = 'feed_1'
        )
    ),
    'render failure did not release the reservation'
);
SELECT ap.retry_territorial_composer_render(
    (SELECT (value #>> '{candidate_news,id}')::uuid
     FROM composer_results WHERE key = 'feed_1')
);
SELECT pg_temp.assert_true(
    (
        SELECT
            reservation.status = 'reserved'
            AND reservation.selected_sponsor_ids = ARRAY[
                'c7000001-0000-4000-8000-000000000001'::uuid,
                'c7000002-0000-4000-8000-000000000002'::uuid
            ]
        FROM ap.territorial_sponsor_reservations AS reservation
        WHERE reservation.candidate_id = (
            SELECT (value #>> '{candidate_news,id}')::uuid
            FROM composer_results
            WHERE key = 'feed_1'
        )
    ),
    'retry did not preserve the originally selected sponsors'
);
SELECT ap.complete_territorial_composer_render(
    (SELECT (value #>> '{candidate_news,id}')::uuid
     FROM composer_results WHERE key = 'feed_1'),
    'https://local.test/render.png'
);
SELECT pg_temp.assert_true(
    (
        SELECT
            reservation.status = 'committed'
            AND candidate.status = 'pending_review'
            AND candidate.render_url = 'https://local.test/render.png'
            AND candidate.render_snapshot #>> '{render_content,headline}'
                = 'Frozen final headline'
        FROM ap.territorial_sponsor_reservations AS reservation
        JOIN ap.candidate_news AS candidate
          ON candidate.id = reservation.candidate_id
        WHERE candidate.id = (
            SELECT (value #>> '{candidate_news,id}')::uuid
            FROM composer_results
            WHERE key = 'feed_1'
        )
    ),
    'successful render did not atomically commit reservation and candidate'
);

SELECT ap.complete_territorial_composer_render(
    (SELECT (value #>> '{candidate_news,id}')::uuid
     FROM composer_results WHERE key = 'feed_1'),
    'https://local.test/render.png'
);
SELECT ap.fail_territorial_composer_render(
    (SELECT (value #>> '{candidate_news,id}')::uuid
     FROM composer_results WHERE key = 'feed_1'),
    'LATE_NETWORK_ERROR'
);
SELECT pg_temp.assert_true(
    (
        SELECT
            reservation.status = 'committed'
            AND candidate.status = 'pending_review'
            AND candidate.error_log IS NULL
        FROM ap.territorial_sponsor_reservations AS reservation
        JOIN ap.candidate_news AS candidate
          ON candidate.id = reservation.candidate_id
        WHERE candidate.id = (
            SELECT (value #>> '{candidate_news,id}')::uuid
            FROM composer_results
            WHERE key = 'feed_1'
        )
    ),
    'duplicate completion or late failure changed a committed render'
);

-- Cities are resolved from their current server-side links, while the created
-- candidate keeps the original region and seal frozen after a later move.
INSERT INTO composer_results (key, value)
SELECT
    'city_before_move',
    ap.create_territorial_composer_candidate(
        'c1000000-0000-4000-8000-000000000001',
        'ca900001-0000-4000-8000-000000000001',
        'feed',
        'cities',
        'City snapshot',
        'Body text',
        NULL,
        'https://local.test/source.png',
        'DESTAQUE',
        NULL,
        'c6000000-0000-4000-8000-000000000001',
        NULL,
        '[]'::jsonb
    );

UPDATE ap.territorial_cities
SET region_id = 'c5000000-0000-4000-8000-000000000002'
WHERE id = 'c6000000-0000-4000-8000-000000000001';

SELECT pg_temp.assert_true(
    (
        SELECT
            value #>> '{candidate_news,render_snapshot,region,id}'
                = 'c5000000-0000-4000-8000-000000000001'
            AND value #>> '{candidate_news,render_snapshot,city,region_id}'
                = 'c5000000-0000-4000-8000-000000000001'
            AND value #>> '{candidate_news,render_snapshot,visual_title,id}'
                = 'c4000000-0000-4000-8000-000000000002'
        FROM composer_results
        WHERE key = 'city_before_move'
    ),
    'moving a city mutated its already frozen region or seal snapshot'
);

UPDATE ap.territorial_cities
SET region_id = 'c5000000-0000-4000-8000-000000000001'
WHERE id = 'c6000000-0000-4000-8000-000000000001';
SELECT set_config('ap.territorial_managed_write', 'on', true);
UPDATE ap.visual_titles
SET ativo = false
WHERE id = 'c4000000-0000-4000-8000-000000000002';
UPDATE ap.territorial_cities
SET ativo = false
WHERE id = 'c6000000-0000-4000-8000-000000000001';
SELECT set_config('ap.territorial_managed_write', 'off', true);

SELECT pg_temp.assert_raises(
    $sql$
        SELECT ap.create_territorial_composer_candidate(
            'c1000000-0000-4000-8000-000000000001',
            gen_random_uuid(),
            'feed',
            'cities',
            'Inactive city',
            'Body text',
            NULL,
            'https://local.test/source.png',
            'DESTAQUE',
            NULL,
            'c6000000-0000-4000-8000-000000000001',
            NULL,
            '[]'::jsonb
        )
    $sql$,
    '23514',
    'inactive city was accepted'
);

SELECT set_config('ap.territorial_managed_write', 'on', true);
UPDATE ap.visual_titles
SET ativo = true
WHERE id = 'c4000000-0000-4000-8000-000000000002';
UPDATE ap.territorial_cities
SET ativo = true
WHERE id = 'c6000000-0000-4000-8000-000000000001';
SELECT set_config('ap.territorial_managed_write', 'off', true);

SELECT pg_temp.assert_raises(
    $sql$
        UPDATE ap.visual_titles
        SET ativo = false
        WHERE id = 'c4000000-0000-4000-8000-000000000002'
    $sql$,
    '42501',
    'managed city seal was allowed to diverge from its city'
);

UPDATE ap.territorial_regions
SET ativo = false
WHERE id = 'c5000000-0000-4000-8000-000000000001';

SELECT pg_temp.assert_raises(
    $sql$
        SELECT ap.create_territorial_composer_candidate(
            'c1000000-0000-4000-8000-000000000001',
            gen_random_uuid(),
            'reels',
            'cities',
            'Inactive city region',
            'Body text',
            NULL,
            NULL,
            'DESTAQUE',
            NULL,
            'c6000000-0000-4000-8000-000000000001',
            NULL,
            '[]'::jsonb
        )
    $sql$,
    '23514',
    'city from an inactive region was accepted'
);

UPDATE ap.territorial_regions
SET ativo = true
WHERE id = 'c5000000-0000-4000-8000-000000000001';

-- Deleting a pre-render candidate releases only its open reservation.
INSERT INTO composer_results (key, value)
SELECT
    'delete_before_render',
    ap.create_territorial_composer_candidate(
        'c1000000-0000-4000-8000-000000000001',
        'ca900002-0000-4000-8000-000000000002',
        'reels',
        'editorial',
        'Delete before render',
        'Body text',
        NULL,
        NULL,
        'DESTAQUE',
        'c5000000-0000-4000-8000-000000000001',
        NULL,
        'c4000000-0000-4000-8000-000000000001',
        '[]'::jsonb
    );

DELETE FROM ap.candidate_news
WHERE id = (
    SELECT (value #>> '{candidate_news,id}')::uuid
    FROM composer_results
    WHERE key = 'delete_before_render'
);

SELECT pg_temp.assert_true(
    (
        SELECT
            reservation.status = 'released'
            AND reservation.release_reason = 'candidate_deleted'
            AND reservation.candidate_id IS NULL
        FROM ap.territorial_sponsor_reservations AS reservation
        WHERE reservation.id = (
            SELECT (value ->> 'reservation_id')::uuid
            FROM composer_results
            WHERE key = 'delete_before_render'
        )
    ),
    'deleting a pre-render candidate did not release its reservation'
);

-- Foreign assets and inactive regions are rejected by the source of truth.
SELECT pg_temp.assert_raises(
    $sql$
        SELECT ap.create_territorial_composer_candidate(
            'c1000000-0000-4000-8000-000000000001',
            'ce000001-0000-4000-8000-000000000001',
            'feed',
            'editorial',
            'Cross tenant',
            'Body text',
            NULL,
            'https://local.test/source.png',
            'DESTAQUE',
            'c5000000-0000-4000-8000-000000000001',
            NULL,
            'd4000000-0000-4000-8000-000000000001',
            '[]'::jsonb
        )
    $sql$,
    '23514',
    'cross-tenant visual title was accepted'
);

SELECT pg_temp.assert_raises(
    $sql$
        SELECT ap.create_territorial_composer_candidate(
            'c1000000-0000-4000-8000-000000000001',
            gen_random_uuid(),
            'feed',
            'editorial',
            'Invalid source URL',
            'Body text',
            NULL,
            'javascript:alert(1)',
            'DESTAQUE',
            'c5000000-0000-4000-8000-000000000001',
            NULL,
            'c4000000-0000-4000-8000-000000000001',
            '[]'::jsonb
        )
    $sql$,
    '23514',
    'invalid source image URL was accepted'
);

UPDATE ap.territorial_regions
SET ativo = false
WHERE id = 'c5000000-0000-4000-8000-000000000002';
SELECT pg_temp.assert_raises(
    $sql$
        SELECT ap.create_territorial_composer_candidate(
            'c1000000-0000-4000-8000-000000000001',
            'cf000001-0000-4000-8000-000000000001',
            'story',
            'individual',
            'Inactive asset',
            'Body text',
            NULL,
            NULL,
            'DESTAQUE',
            NULL,
            NULL,
            NULL,
            '[{
                "slot":"footer_slot_1",
                "source_type":"region",
                "source_id":"c5000000-0000-4000-8000-000000000002"
            }]'::jsonb
        )
    $sql$,
    '23514',
    'inactive manual asset was accepted'
);

-- The same authenticated user cannot address another tenant.
SELECT pg_temp.assert_raises(
    $sql$
        SELECT ap.get_territorial_composer_catalog(
            'd1000000-0000-4000-8000-000000000002'
        )
    $sql$,
    '42501',
    'cross-tenant catalog access was accepted'
);

-- A legitimate user from the disabled tenant is still rejected by the backend.
SELECT set_config(
    'request.jwt.claims',
    '{"role":"authenticated","sub":"d2000000-0000-4000-8000-000000000002"}',
    true
);
SELECT pg_temp.assert_raises(
    $sql$
        SELECT ap.get_territorial_composer_catalog(
            'd1000000-0000-4000-8000-000000000002'
        )
    $sql$,
    '42501',
    'disabled tenant reached territorial composer RPC'
);

SELECT pg_temp.assert_raises(
    $sql$
        SELECT ap.create_territorial_composer_candidate(
            'd1000000-0000-4000-8000-000000000002',
            gen_random_uuid(),
            'feed',
            'editorial',
            'Disabled tenant',
            'Body text',
            NULL,
            'https://local.test/source.png',
            'DESTAQUE',
            gen_random_uuid(),
            NULL,
            gen_random_uuid(),
            '[]'::jsonb
        )
    $sql$,
    '42501',
    'disabled tenant reached territorial creation RPC'
);

SELECT pg_temp.assert_true(
    NOT has_function_privilege(
        'anon',
        'ap.get_territorial_composer_catalog(uuid)',
        'EXECUTE'
    )
    AND NOT has_function_privilege(
        'anon',
        'ap.create_territorial_composer_candidate(uuid,uuid,text,text,text,text,text,text,text,uuid,uuid,uuid,jsonb)',
        'EXECUTE'
    ),
    'anon retained territorial composer RPC execution'
);

SELECT pg_temp.assert_true(
    EXISTS (
        SELECT 1
        FROM ap.candidate_news
        WHERE content_type = 'story'
          AND render_contract_version = 'territorial_composer_v1'
    ),
    'Story candidate was not accepted by the additive constraint'
);

ROLLBACK;

\echo territorial-composer-contract.sql: PASS
