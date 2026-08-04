\set ON_ERROR_STOP on

-- Full transactional contract for the additive territorial administration.
-- It writes only disposable local fixtures and rolls everything back.
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

CREATE TEMP TABLE territorial_test_ids (
    key text PRIMARY KEY,
    value uuid NOT NULL
);

CREATE TEMP TABLE territorial_baseline AS
SELECT
    (SELECT count(*) FROM ap.candidate_news) AS candidate_count,
    (SELECT count(*) FROM ap.render_sponsor_rotation_state) AS rotation_count,
    (SELECT count(*) FROM ap.master_render_configs) AS master_count;

INSERT INTO public.clientes (id, nome)
VALUES
    ('a1000000-0000-4000-8000-000000000001', 'Territorial Tenant A'),
    ('b1000000-0000-4000-8000-000000000002', 'Territorial Tenant B');

INSERT INTO auth.users (id, email)
VALUES
    ('a2000000-0000-4000-8000-000000000001', 'territorial-a@example.test'),
    ('b2000000-0000-4000-8000-000000000002', 'territorial-b@example.test');

INSERT INTO public.cliente_profissionais (
    cliente_id,
    profissional_id,
    funcao,
    ativo
)
VALUES
    (
        'a1000000-0000-4000-8000-000000000001',
        'a2000000-0000-4000-8000-000000000001',
        'editor',
        true
    ),
    (
        'b1000000-0000-4000-8000-000000000002',
        'b2000000-0000-4000-8000-000000000002',
        'editor',
        true
    );

INSERT INTO ap.system_config (
    cliente_id,
    ingestion_enabled,
    territorial_admin_enabled
)
VALUES
    ('a1000000-0000-4000-8000-000000000001', true, true),
    ('b1000000-0000-4000-8000-000000000002', true, false)
ON CONFLICT (cliente_id)
DO UPDATE SET territorial_admin_enabled = EXCLUDED.territorial_admin_enabled;

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
        'a3000000-0000-4000-8000-000000000001',
        'a1000000-0000-4000-8000-000000000001',
        'CIDADES',
        'cidades',
        0,
        true
    ),
    (
        'b3000000-0000-4000-8000-000000000002',
        'b1000000-0000-4000-8000-000000000002',
        'CIDADES',
        'cidades',
        0,
        true
    );

SELECT set_config(
    'request.jwt.claims',
    '{"role":"authenticated","sub":"a2000000-0000-4000-8000-000000000001"}',
    true
);

-- Region creation and case/whitespace-insensitive uniqueness.
INSERT INTO territorial_test_ids (key, value)
SELECT
    'region_a_1',
    (
        ap.create_territorial_region(
            'a1000000-0000-4000-8000-000000000001',
            'Vale   do Paraíba',
            'ap-images',
            'regions/a1000000-0000-4000-8000-000000000001/vale-do-paraiba/'
                || repeat('1', 64)
                || '.png',
            left(repeat('1', 64), 12),
            repeat('1', 64),
            '{"source":"contract"}'::jsonb,
            true
        ) ->> 'id'
    )::uuid;

SELECT pg_temp.assert_true(
    (
        SELECT nome = 'Vale do Paraíba' AND ativo
        FROM ap.territorial_regions
        WHERE id = (
            SELECT value FROM territorial_test_ids WHERE key = 'region_a_1'
        )
    ),
    'region name was not normalized or region was not active'
);

SELECT pg_temp.assert_raises(
    $sql$
        SELECT ap.create_territorial_region(
            'a1000000-0000-4000-8000-000000000001',
            '  VALE do   PARAÍBA ',
            'ap-images',
            'regions/a1000000-0000-4000-8000-000000000001/vale-do-paraiba/'
                || repeat('2', 64)
                || '.png',
            left(repeat('2', 64), 12),
            repeat('2', 64),
            '{}'::jsonb,
            true
        )
    $sql$,
    '23505',
    'duplicate region name was accepted'
);

INSERT INTO territorial_test_ids (key, value)
SELECT
    'region_a_2',
    (
        ap.create_territorial_region(
            'a1000000-0000-4000-8000-000000000001',
            'Litoral Norte',
            'ap-images',
            'regions/a1000000-0000-4000-8000-000000000001/litoral-norte/'
                || repeat('3', 64)
                || '.png',
            left(repeat('3', 64), 12),
            repeat('3', 64),
            '{}'::jsonb,
            true
        ) ->> 'id'
    )::uuid;

-- Tenant B has a region inserted as privileged test setup, but its feature flag
-- remains disabled so its user cannot mutate territorial data through the RPC.
INSERT INTO ap.territorial_regions (
    id,
    cliente_id,
    nome,
    slug,
    asset_bucket,
    asset_path,
    asset_version,
    sha256,
    asset_metadata,
    ativo
)
VALUES (
    'b4000000-0000-4000-8000-000000000002',
    'b1000000-0000-4000-8000-000000000002',
    'Região B',
    'regiao-b',
    'ap-images',
    'regions/b1000000-0000-4000-8000-000000000002/regiao-b/'
        || repeat('4', 64)
        || '.png',
    left(repeat('4', 64), 12),
    repeat('4', 64),
    '{}'::jsonb,
    true
);

-- City + visual title are created as one atomic result.
INSERT INTO territorial_test_ids (key, value)
SELECT
    'city_a',
    (
        ap.create_territorial_city(
            (SELECT value FROM territorial_test_ids WHERE key = 'region_a_1'),
            'São José dos Campos',
            'ap-images',
            'cities/a1000000-0000-4000-8000-000000000001/sao-jose-dos-campos/'
                || repeat('5', 64)
                || '.png',
            left(repeat('5', 64), 12),
            repeat('5', 64),
            '{"width":1230,"height":464}'::jsonb,
            true
        ) #>> '{city,id}'
    )::uuid;

INSERT INTO territorial_test_ids (key, value)
SELECT
    'city_title_a',
    visual_title_id
FROM ap.territorial_cities
WHERE id = (SELECT value FROM territorial_test_ids WHERE key = 'city_a');

SELECT pg_temp.assert_true(
    (
        SELECT
            city.cliente_id = title.cliente_id
            AND city.nome = title.nome
            AND city.slug = title.slug
            AND city.asset_path = title.asset_path
            AND city.asset_version = title.asset_version
            AND city.sha256 = title.sha256
            AND city.ativo = title.ativo
            AND title.tipo = 'cidade'
            AND title.formatos = ARRAY['feed', 'reels']::text[]
        FROM ap.territorial_cities AS city
        JOIN ap.visual_titles AS title
          ON title.id = city.visual_title_id
        WHERE city.id = (
            SELECT value FROM territorial_test_ids WHERE key = 'city_a'
        )
    ),
    'city and automatically created title are not synchronized'
);

-- A visual-title insertion failure rolls the whole city operation back.
INSERT INTO ap.visual_titles (
    cliente_id,
    nome,
    slug,
    asset_bucket,
    asset_path,
    asset_version,
    sha256,
    ativo,
    ordem,
    formatos,
    group_id,
    tipo
)
VALUES (
    'a1000000-0000-4000-8000-000000000001',
    'Editorial collision',
    'cidade-falha',
    'ap-images',
    'visual-titles/a1000000-0000-4000-8000-000000000001/cidade-falha/'
        || repeat('6', 64)
        || '.png',
    left(repeat('6', 64), 12),
    repeat('6', 64),
    true,
    99,
    ARRAY['feed', 'reels']::text[],
    NULL,
    'editorial'
);

SELECT pg_temp.assert_raises(
    format(
        $sql$
            SELECT ap.create_territorial_city(
                %L::uuid,
                'Cidade Falha',
                'ap-images',
                'cities/a1000000-0000-4000-8000-000000000001/cidade-falha/%s.png',
                '%s',
                '%s',
                '{}'::jsonb,
                true
            )
        $sql$,
        (SELECT value FROM territorial_test_ids WHERE key = 'region_a_1'),
        repeat('7', 64),
        left(repeat('7', 64), 12),
        repeat('7', 64)
    ),
    '23505',
    'visual-title failure did not abort city creation'
);

SELECT pg_temp.assert_true(
    NOT EXISTS (
        SELECT 1
        FROM ap.territorial_cities
        WHERE cliente_id = 'a1000000-0000-4000-8000-000000000001'
          AND ap.normalize_territorial_name(nome) = 'cidade falha'
    ),
    'failed title creation left a partial city'
);

-- Editing name/image and moving region preserves the same title ID.
SELECT ap.update_territorial_city(
    (SELECT value FROM territorial_test_ids WHERE key = 'city_a'),
    (SELECT value FROM territorial_test_ids WHERE key = 'region_a_2'),
    'São José dos Campos Centro',
    'ap-images',
    'cities/a1000000-0000-4000-8000-000000000001/sao-jose-dos-campos-centro/'
        || repeat('8', 64)
        || '.png',
    left(repeat('8', 64), 12),
    repeat('8', 64),
    '{"revision":2}'::jsonb
);

SELECT pg_temp.assert_true(
    (
        SELECT
            city.region_id = (
                SELECT value
                FROM territorial_test_ids
                WHERE key = 'region_a_2'
            )
            AND city.visual_title_id = (
                SELECT value
                FROM territorial_test_ids
                WHERE key = 'city_title_a'
            )
            AND city.nome = 'São José dos Campos Centro'
            AND title.nome = city.nome
            AND title.asset_path = city.asset_path
            AND title.sha256 = repeat('8', 64)
        FROM ap.territorial_cities AS city
        JOIN ap.visual_titles AS title
          ON title.id = city.visual_title_id
        WHERE city.id = (
            SELECT value FROM territorial_test_ids WHERE key = 'city_a'
        )
    ),
    'city edit/move changed title identity or broke synchronized fields'
);

-- City availability is atomic in both directions.
SELECT ap.set_territorial_city_active(
    (SELECT value FROM territorial_test_ids WHERE key = 'city_a'),
    false
);
SELECT pg_temp.assert_true(
    (
        SELECT NOT city.ativo AND NOT title.ativo
        FROM ap.territorial_cities AS city
        JOIN ap.visual_titles AS title
          ON title.id = city.visual_title_id
        WHERE city.id = (
            SELECT value FROM territorial_test_ids WHERE key = 'city_a'
        )
    ),
    'city deactivation did not deactivate the title'
);

SELECT ap.set_territorial_city_active(
    (SELECT value FROM territorial_test_ids WHERE key = 'city_a'),
    true
);
SELECT pg_temp.assert_true(
    (
        SELECT city.ativo AND title.ativo
        FROM ap.territorial_cities AS city
        JOIN ap.visual_titles AS title
          ON title.id = city.visual_title_id
        WHERE city.id = (
            SELECT value FROM territorial_test_ids WHERE key = 'city_a'
        )
    ),
    'city reactivation did not reactivate the title'
);

-- Region availability never mutates city/title flags.
SELECT ap.set_territorial_region_active(
    (SELECT value FROM territorial_test_ids WHERE key = 'region_a_2'),
    false
);
SELECT pg_temp.assert_true(
    (
        SELECT
            NOT region.ativo
            AND city.ativo
            AND title.ativo
        FROM ap.territorial_regions AS region
        JOIN ap.territorial_cities AS city
          ON city.region_id = region.id
        JOIN ap.visual_titles AS title
          ON title.id = city.visual_title_id
        WHERE city.id = (
            SELECT value FROM territorial_test_ids WHERE key = 'city_a'
        )
    ),
    'region deactivation cascaded into city/title status'
);

-- A managed city title cannot be edited through the legacy direct-update path
-- and cannot be reclassified as editorial.
SELECT pg_temp.assert_raises(
    format(
        'UPDATE ap.visual_titles SET nome = %L WHERE id = %L::uuid',
        'Direct edit forbidden',
        (SELECT value FROM territorial_test_ids WHERE key = 'city_title_a')
    ),
    '42501',
    'managed city title accepted a direct legacy edit'
);
SELECT pg_temp.assert_raises(
    format(
        'SELECT ap.set_visual_title_type(%L::uuid, %L)',
        (SELECT value FROM territorial_test_ids WHERE key = 'city_title_a'),
        'editorial'
    ),
    '23514',
    'managed city title was reclassified as editorial'
);

-- Existing render sponsors can belong to several regions. Association removal
-- is historical and scoped to one region only.
INSERT INTO ap.render_sponsors (
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
        'a5000000-0000-4000-8000-000000000001',
        'a1000000-0000-4000-8000-000000000001',
        'Sponsor A',
        'sponsor-a',
        'ap-images',
        'sponsors/a1000000-0000-4000-8000-000000000001/sponsor-a/'
            || repeat('9', 64)
            || '.png',
        left(repeat('9', 64), 12),
        repeat('9', 64),
        true
    ),
    (
        'b5000000-0000-4000-8000-000000000002',
        'b1000000-0000-4000-8000-000000000002',
        'Sponsor B',
        'sponsor-b',
        'ap-images',
        'sponsors/b1000000-0000-4000-8000-000000000002/sponsor-b/'
            || repeat('a', 64)
            || '.png',
        left(repeat('a', 64), 12),
        repeat('a', 64),
        true
    );

SELECT ap.set_territorial_region_sponsor(
    (SELECT value FROM territorial_test_ids WHERE key = 'region_a_1'),
    'a5000000-0000-4000-8000-000000000001',
    true
);
SELECT ap.set_territorial_region_sponsor(
    (SELECT value FROM territorial_test_ids WHERE key = 'region_a_2'),
    'a5000000-0000-4000-8000-000000000001',
    true
);
-- Idempotent re-association must not create a duplicate row.
SELECT ap.set_territorial_region_sponsor(
    (SELECT value FROM territorial_test_ids WHERE key = 'region_a_1'),
    'a5000000-0000-4000-8000-000000000001',
    true
);

SELECT pg_temp.assert_true(
    (
        SELECT count(*) = 2
        FROM ap.territorial_region_sponsors
        WHERE cliente_id = 'a1000000-0000-4000-8000-000000000001'
          AND sponsor_id = 'a5000000-0000-4000-8000-000000000001'
    ),
    'duplicate region/sponsor association was created'
);

UPDATE ap.render_sponsors
SET ativo = false
WHERE id = 'a5000000-0000-4000-8000-000000000001';
SELECT pg_temp.assert_true(
    (
        SELECT count(*) = 2
        FROM ap.territorial_region_sponsors
        WHERE sponsor_id = 'a5000000-0000-4000-8000-000000000001'
          AND ativo
    ),
    'deactivating the general sponsor destroyed region associations'
);

SELECT ap.set_territorial_region_sponsor(
    (SELECT value FROM territorial_test_ids WHERE key = 'region_a_1'),
    'a5000000-0000-4000-8000-000000000001',
    false
);
SELECT pg_temp.assert_true(
    (
        SELECT
            count(*) FILTER (WHERE ativo) = 1
            AND count(*) FILTER (WHERE NOT ativo AND removed_at IS NOT NULL) = 1
        FROM ap.territorial_region_sponsors
        WHERE sponsor_id = 'a5000000-0000-4000-8000-000000000001'
    ),
    'removing one region association affected another region or lost history'
);

-- Cross-tenant RPC attempts are rejected before any write.
SELECT pg_temp.assert_raises(
    $sql$
        SELECT ap.create_territorial_region(
            'b1000000-0000-4000-8000-000000000002',
            'Foreign Region',
            'ap-images',
            'regions/b1000000-0000-4000-8000-000000000002/foreign/'
                || repeat('b', 64)
                || '.png',
            left(repeat('b', 64), 12),
            repeat('b', 64),
            '{}'::jsonb,
            true
        )
    $sql$,
    '42501',
    'tenant A user created a tenant B region'
);

SELECT pg_temp.assert_raises(
    format(
        $sql$
            SELECT ap.update_territorial_city(
                %L::uuid,
                'b4000000-0000-4000-8000-000000000002',
                'Cross Tenant Move',
                'ap-images',
                'cities/a1000000-0000-4000-8000-000000000001/cross/%s.png',
                '%s',
                '%s',
                '{}'::jsonb
            )
        $sql$,
        (SELECT value FROM territorial_test_ids WHERE key = 'city_a'),
        repeat('c', 64),
        left(repeat('c', 64), 12),
        repeat('c', 64)
    ),
    '42501',
    'city moved to a foreign-tenant region'
);

SELECT pg_temp.assert_raises(
    format(
        'SELECT ap.set_territorial_region_sponsor(%L::uuid, %L::uuid, true)',
        (SELECT value FROM territorial_test_ids WHERE key = 'region_a_1'),
        'b5000000-0000-4000-8000-000000000002'
    ),
    '42501',
    'foreign-tenant sponsor was associated'
);

-- Feature flag is enforced server-side, not only hidden in React.
SELECT set_config(
    'request.jwt.claims',
    '{"role":"authenticated","sub":"b2000000-0000-4000-8000-000000000002"}',
    true
);
SELECT pg_temp.assert_raises(
    $sql$
        SELECT ap.set_territorial_region_active(
            'b4000000-0000-4000-8000-000000000002',
            false
        )
    $sql$,
    '42501',
    'disabled tenant mutated territorial data'
);

-- RLS sees only the authenticated user's tenant in both directions.
SELECT set_config(
    'request.jwt.claims',
    '{"role":"authenticated","sub":"a2000000-0000-4000-8000-000000000001"}',
    true
);
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true(
    (
        SELECT count(*) > 0
        FROM ap.territorial_regions
    ),
    'tenant A cannot read its regions'
);
SELECT pg_temp.assert_true(
    NOT EXISTS (
        SELECT 1
        FROM ap.territorial_regions
        WHERE cliente_id = 'b1000000-0000-4000-8000-000000000002'
    ),
    'tenant A can read tenant B regions'
);
RESET ROLE;

SELECT set_config(
    'request.jwt.claims',
    '{"role":"authenticated","sub":"b2000000-0000-4000-8000-000000000002"}',
    true
);
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true(
    (
        SELECT count(*) = 1
        FROM ap.territorial_regions
    ),
    'tenant B RLS result is not isolated'
);
SELECT pg_temp.assert_true(
    NOT EXISTS (
        SELECT 1
        FROM ap.territorial_regions
        WHERE cliente_id = 'a1000000-0000-4000-8000-000000000001'
    ),
    'tenant B can read tenant A regions'
);
RESET ROLE;

-- anon has neither table reads nor RPC execution.
SELECT pg_temp.assert_true(
    NOT has_table_privilege('anon', 'ap.territorial_regions', 'SELECT')
    AND NOT has_table_privilege('anon', 'ap.territorial_cities', 'SELECT')
    AND NOT has_table_privilege(
        'anon',
        'ap.territorial_region_sponsors',
        'SELECT'
    ),
    'anon retained a territorial table privilege'
);
SELECT pg_temp.assert_true(
    NOT has_function_privilege(
        'anon',
        'ap.create_territorial_region(uuid,text,text,text,text,text,jsonb,boolean)',
        'EXECUTE'
    ),
    'anon retained territorial RPC execution'
);

-- Backfill completeness and expected classification for every current group.
SELECT pg_temp.assert_true(
    NOT EXISTS (
        SELECT 1
        FROM ap.visual_titles
        WHERE tipo IS NULL
           OR tipo NOT IN ('editorial', 'cidade')
    ),
    'visual-title type backfill is incomplete'
);
SELECT pg_temp.assert_true(
    NOT EXISTS (
        SELECT 1
        FROM ap.visual_titles AS title
        JOIN ap.visual_title_groups AS group_row
          ON group_row.id = title.group_id
         AND group_row.cliente_id = title.cliente_id
        WHERE (
            ap.normalize_territorial_name(group_row.nome) = 'cidades'
            AND title.tipo <> 'cidade'
        ) OR (
            ap.normalize_territorial_name(group_row.nome) IN (
                'editorial',
                'estados/mundo',
                'eventos'
            )
            AND title.tipo <> 'editorial'
        )
    ),
    'known visual-title groups were classified incorrectly'
);

-- Existing operational contracts remain structurally and behaviorally outside

-- A legacy caller that predates the explicit type column can still insert a
-- normal editorial seal. The NOT NULL contract is satisfied by the safe
-- editorial default and no existing caller needs to send a new field.
INSERT INTO ap.visual_title_groups (
    id,
    cliente_id,
    nome,
    slug,
    ordem,
    ativo
)
VALUES (
    'a3000000-0000-4000-8000-000000000099',
    'a1000000-0000-4000-8000-000000000001',
    'EDITORIAL',
    'editorial',
    99,
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
    formatos,
    ativo,
    ordem
)
VALUES (
    'a6000000-0000-4000-8000-000000000099',
    'a1000000-0000-4000-8000-000000000001',
    'a3000000-0000-4000-8000-000000000099',
    'Legacy editorial insert',
    'legacy-editorial-insert',
    'ap-images',
    'visual-titles/a1000000-0000-4000-8000-000000000001/legacy/'
        || repeat('9', 64)
        || '.png',
    left(repeat('9', 64), 12),
    repeat('9', 64),
    ARRAY['feed']::text[],
    true,
    99
);

SELECT pg_temp.assert_true(
    (
        SELECT tipo = 'editorial'
        FROM ap.visual_titles
        WHERE id = 'a6000000-0000-4000-8000-000000000099'
    ),
    'legacy visual-title insert did not receive the editorial default'
);
-- this feature.
SELECT pg_temp.assert_true(
    (
        SELECT
            candidate_count = (SELECT count(*) FROM ap.candidate_news)
            AND rotation_count = (
                SELECT count(*) FROM ap.render_sponsor_rotation_state
            )
            AND master_count = (
                SELECT count(*) FROM ap.master_render_configs
            )
        FROM territorial_baseline
    ),
    'territorial administration changed candidate, rotation or master rows'
);
SELECT pg_temp.assert_true(
    to_regclass('ap.visual_title_groups') IS NOT NULL
    AND to_regclass('ap.render_sponsors') IS NOT NULL
    AND to_regclass('ap.render_sponsor_scope_memberships') IS NOT NULL,
    'an existing catalog/rotation table disappeared'
);

\echo territorial-admin-contract.sql: PASS
ROLLBACK;
