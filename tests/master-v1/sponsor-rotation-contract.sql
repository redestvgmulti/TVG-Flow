\set ON_ERROR_STOP on

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.assert_true(
    p_condition boolean,
    p_message text
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
    IF NOT COALESCE(p_condition, false) THEN
        RAISE EXCEPTION 'ASSERTION_FAILED: %', p_message;
    END IF;
END;
$$;

INSERT INTO public.clientes (id, nome)
VALUES
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Client A'),
    ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Client B');

INSERT INTO public.cliente_profissionais (
    cliente_id,
    profissional_id,
    ativo
)
VALUES
    (
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        '11111111-1111-4111-8111-111111111111',
        true
    ),
    (
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        '22222222-2222-4222-8222-222222222222',
        true
    );

INSERT INTO ap.templates (
    id,
    empresa_id,
    placid_template_uuid,
    nome,
    ordem,
    tipo,
    template_set
)
VALUES
    (
        '10000000-0000-4000-8000-000000000001',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'feed-default-1',
        'Feed Default 1',
        0,
        'feed',
        'default'
    ),
    (
        '10000000-0000-4000-8000-000000000002',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'feed-default-2',
        'Feed Default 2',
        1,
        'feed',
        'default'
    ),
    (
        '10000000-0000-4000-8000-000000000003',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'feed-zero',
        'Feed Zero',
        0,
        'feed',
        'zero'
    ),
    (
        '10000000-0000-4000-8000-000000000004',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'feed-empty',
        'Feed Empty',
        0,
        'feed',
        'empty'
    ),
    (
        '10000000-0000-4000-8000-000000000005',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'feed-one',
        'Feed One',
        0,
        'feed',
        'one'
    ),
    (
        '10000000-0000-4000-8000-000000000006',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'feed-inactive-sponsor',
        'Feed Inactive Sponsor',
        0,
        'feed',
        'inactive-sponsor'
    ),
    (
        '10000000-0000-4000-8000-000000000007',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'feed-inactive-membership',
        'Feed Inactive Membership',
        0,
        'feed',
        'inactive-membership'
    ),
    (
        '10000000-0000-4000-8000-000000000008',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'feed-other',
        'Feed Other',
        0,
        'feed',
        'other'
    ),
    (
        '20000000-0000-4000-8000-000000000001',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'reels-default-1',
        'Reels Default 1',
        0,
        'reels',
        'default'
    ),
    (
        '20000000-0000-4000-8000-000000000002',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'reels-default-2',
        'Reels Default 2',
        1,
        'reels',
        'default'
    ),
    (
        '30000000-0000-4000-8000-000000000001',
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        'client-b-feed',
        'Client B Feed',
        0,
        'feed',
        'default'
    );

INSERT INTO ap.visual_titles (
    id,
    cliente_id,
    nome,
    slug,
    asset_bucket,
    asset_path,
    asset_version,
    sha256,
    formatos
)
VALUES (
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'Esporte',
    'esporte',
    'ap-images',
    'visual-titles/a/esporte/version-1.png',
    'version-1',
    repeat('e', 64),
    ARRAY['feed', 'reels']::text[]
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
    ativo
)
VALUES
    (
        '00000000-0000-4000-8000-000000000001',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'A',
        'a',
        'ap-images',
        'sponsors/a/a.png',
        'a1',
        repeat('a', 64),
        true
    ),
    (
        '00000000-0000-4000-8000-000000000002',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'B',
        'b',
        'ap-images',
        'sponsors/a/b.png',
        'b1',
        repeat('b', 64),
        true
    ),
    (
        '00000000-0000-4000-8000-000000000003',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'C',
        'c',
        'ap-images',
        'sponsors/a/c.png',
        'c1',
        repeat('c', 64),
        true
    ),
    (
        '00000000-0000-4000-8000-000000000004',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'D',
        'd',
        'ap-images',
        'sponsors/a/d.png',
        'd1',
        repeat('d', 64),
        true
    ),
    (
        '00000000-0000-4000-8000-000000000005',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'Inactive',
        'inactive',
        'ap-images',
        'sponsors/a/inactive.png',
        'inactive1',
        repeat('f', 64),
        false
    ),
    (
        '00000000-0000-4000-8000-000000000006',
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        'Client B Sponsor',
        'client-b-sponsor',
        'ap-images',
        'sponsors/b/b.png',
        'b1',
        repeat('9', 64),
        true
    );

INSERT INTO ap.render_sponsor_scope_memberships (
    sponsor_id,
    cliente_id,
    template_set,
    content_type,
    ordem,
    ativo
)
SELECT
    sponsor_id,
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
    'default',
    'feed',
    ordem,
    true
FROM (
    VALUES
        ('00000000-0000-4000-8000-000000000001'::uuid, 0),
        ('00000000-0000-4000-8000-000000000002'::uuid, 1),
        ('00000000-0000-4000-8000-000000000003'::uuid, 2),
        ('00000000-0000-4000-8000-000000000004'::uuid, 3)
) AS feed_pool(sponsor_id, ordem);

INSERT INTO ap.render_sponsor_scope_memberships (
    sponsor_id,
    cliente_id,
    template_set,
    content_type,
    ordem,
    ativo
)
VALUES
    (
        '00000000-0000-4000-8000-000000000001',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'default',
        'reels',
        0,
        true
    ),
    (
        '00000000-0000-4000-8000-000000000002',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'default',
        'reels',
        1,
        true
    ),
    (
        '00000000-0000-4000-8000-000000000001',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'one',
        'feed',
        0,
        true
    ),
    (
        '00000000-0000-4000-8000-000000000005',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'inactive-sponsor',
        'feed',
        0,
        true
    ),
    (
        '00000000-0000-4000-8000-000000000001',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'inactive-membership',
        'feed',
        0,
        false
    ),
    (
        '00000000-0000-4000-8000-000000000002',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'other',
        'feed',
        0,
        true
    );

CREATE OR REPLACE FUNCTION pg_temp.call_rotation(
    p_key uuid,
    p_count integer,
    p_set text,
    p_type text,
    p_title text
)
RETURNS jsonb
LANGUAGE sql
AS $$
    SELECT ap.create_candidate_with_sponsors(
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
        p_key,
        p_type,
        p_set,
        p_count::smallint,
        p_title,
        'Conteudo base',
        NULL,
        NULL,
        'Categoria',
        '11111111-1111-4111-8111-111111111111'::uuid,
        'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'::uuid,
        'master_v1',
        '{"master_template_uuid":"future-master"}'::jsonb
    );
$$;

SELECT set_config(
    'request.jwt.claims',
    '{"role":"service_role","sub":"11111111-1111-4111-8111-111111111111"}',
    true
);
SET LOCAL ROLE service_role;

-- sponsor_count NULL remains available for legacy rows.
INSERT INTO ap.candidate_news (
    cliente_id,
    status,
    titulo,
    url_original,
    content_type,
    template_set
)
VALUES (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'raw',
    'Legacy row',
    '',
    'feed',
    'default'
);

SELECT pg_temp.assert_true(
    (
        SELECT sponsor_count IS NULL
           AND idempotency_key IS NULL
           AND render_contract_version = 'legacy'
        FROM ap.candidate_news
        WHERE titulo = 'Legacy row'
    ),
    'legacy row defaults changed'
);

DO $$
BEGIN
    BEGIN
        PERFORM pg_temp.call_rotation(
            '01000000-0000-4000-8000-000000000001',
            NULL,
            'default',
            'feed',
            'Null count'
        );
        RAISE EXCEPTION 'expected SPONSOR_COUNT_INVALID';
    EXCEPTION
        WHEN SQLSTATE '22023' THEN
            IF SQLERRM <> 'SPONSOR_COUNT_INVALID' THEN
                RAISE;
            END IF;
    END;
END;
$$;

-- Count zero creates no sponsor state and does not inspect a sponsor pool.
DO $$
DECLARE
    v_result jsonb;
BEGIN
    v_result := pg_temp.call_rotation(
        '01000000-0000-4000-8000-000000000002',
        0,
        'zero',
        'feed',
        'Zero sponsors'
    );

    PERFORM pg_temp.assert_true(
        v_result #> '{sponsor_selection,items}' = '[]'::jsonb,
        'count zero returned sponsor items'
    );
    PERFORM pg_temp.assert_true(
        v_result #>> '{sponsor_selection,cursor_before}' =
        v_result #>> '{sponsor_selection,cursor_after}',
        'count zero changed its logical cursor'
    );
    PERFORM pg_temp.assert_true(
        NOT EXISTS (
            SELECT 1
            FROM ap.render_sponsor_rotation_state
            WHERE cliente_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
              AND template_set = 'zero'
              AND content_type = 'feed'
        ),
        'count zero created rotation state'
    );
END;
$$;

-- Required sequence: A; B; C+D; A+B.
DO $$
DECLARE
    v_one jsonb;
    v_two jsonb;
    v_three jsonb;
    v_four jsonb;
BEGIN
    v_one := pg_temp.call_rotation(
        '02000000-0000-4000-8000-000000000001',
        1,
        'default',
        'feed',
        'Sequence 1'
    );
    v_two := pg_temp.call_rotation(
        '02000000-0000-4000-8000-000000000002',
        1,
        'default',
        'feed',
        'Sequence 2'
    );
    v_three := pg_temp.call_rotation(
        '02000000-0000-4000-8000-000000000003',
        2,
        'default',
        'feed',
        'Sequence 3'
    );
    v_four := pg_temp.call_rotation(
        '02000000-0000-4000-8000-000000000004',
        2,
        'default',
        'feed',
        'Sequence 4'
    );

    PERFORM pg_temp.assert_true(
        v_one #>> '{sponsor_selection,items,0,name}' = 'A',
        'first one-count selection was not A'
    );
    PERFORM pg_temp.assert_true(
        v_two #>> '{sponsor_selection,items,0,name}' = 'B',
        'second one-count selection was not B'
    );
    PERFORM pg_temp.assert_true(
        v_three #>> '{sponsor_selection,items,0,name}' = 'C'
        AND v_three #>> '{sponsor_selection,items,1,name}' = 'D',
        'two-count selection was not C+D'
    );
    PERFORM pg_temp.assert_true(
        v_four #>> '{sponsor_selection,items,0,name}' = 'A'
        AND v_four #>> '{sponsor_selection,items,1,name}' = 'B',
        'wrapped two-count selection was not A+B'
    );
    PERFORM pg_temp.assert_true(
        v_three #>> '{sponsor_selection,items,0,sponsor_id}'
        <> v_three #>> '{sponsor_selection,items,1,sponsor_id}',
        'same sponsor occupied both slots'
    );
    PERFORM pg_temp.assert_true(
        v_three #>> '{sponsor_selection,items,0,slot}' = 'sponsor_1'
        AND v_three #>> '{sponsor_selection,items,1,slot}' = 'sponsor_2',
        'slot identity was not preserved'
    );
END;
$$;

-- Empty pools, inactive sponsors and inactive memberships fail without state.
DO $$
DECLARE
    v_set text;
BEGIN
    FOREACH v_set IN ARRAY ARRAY[
        'empty',
        'inactive-sponsor',
        'inactive-membership'
    ] LOOP
        BEGIN
            PERFORM pg_temp.call_rotation(
                gen_random_uuid(),
                1,
                v_set,
                'feed',
                'Insufficient pool'
            );
            RAISE EXCEPTION 'expected pool failure for %', v_set;
        EXCEPTION
            WHEN SQLSTATE 'P0001' THEN
                IF SQLERRM NOT LIKE 'SPONSOR_POOL_INSUFFICIENT%' THEN
                    RAISE;
                END IF;
        END;

        PERFORM pg_temp.assert_true(
            NOT EXISTS (
                SELECT 1
                FROM ap.render_sponsor_rotation_state
                WHERE cliente_id =
                    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
                  AND template_set = v_set
                  AND content_type = 'feed'
            ),
            'failed pool created state for ' || v_set
        );
        PERFORM pg_temp.assert_true(
            NOT EXISTS (
                SELECT 1
                FROM ap.template_queue_state
                WHERE empresa_id =
                    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
                  AND template_set = v_set
                  AND tipo = 'feed'
            ),
            'template cursor did not rollback for ' || v_set
        );
    END LOOP;
END;
$$;

DO $$
BEGIN
    BEGIN
        PERFORM pg_temp.call_rotation(
            '03000000-0000-4000-8000-000000000001',
            2,
            'one',
            'feed',
            'Pool one'
        );
        RAISE EXCEPTION 'expected count two to fail with one sponsor';
    EXCEPTION
        WHEN SQLSTATE 'P0001' THEN
            IF SQLERRM NOT LIKE 'SPONSOR_POOL_INSUFFICIENT%' THEN
                RAISE;
            END IF;
    END;
END;
$$;

-- Feed and Reels use independent states.
DO $$
DECLARE
    v_feed_before integer;
    v_reels jsonb;
BEGIN
    SELECT current_index
    INTO v_feed_before
    FROM ap.render_sponsor_rotation_state
    WHERE cliente_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      AND template_set = 'default'
      AND content_type = 'feed';

    v_reels := pg_temp.call_rotation(
        '04000000-0000-4000-8000-000000000001',
        1,
        'default',
        'reels',
        'Reels independent'
    );

    PERFORM pg_temp.assert_true(
        v_reels #>> '{sponsor_selection,items,0,name}' = 'A',
        'Reels did not start from its own first sponsor'
    );
    PERFORM pg_temp.assert_true(
        (
            SELECT current_index = v_feed_before
            FROM ap.render_sponsor_rotation_state
            WHERE cliente_id =
                'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
              AND template_set = 'default'
              AND content_type = 'feed'
        ),
        'Reels advanced Feed state'
    );
END;
$$;

RESET ROLE;

-- Out-of-range cursor, removal and order changes remain deterministic.
UPDATE ap.render_sponsor_rotation_state
SET current_index = 99
WHERE cliente_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  AND template_set = 'default'
  AND content_type = 'feed';

SELECT pg_temp.assert_true(
    pg_temp.call_rotation(
        '05000000-0000-4000-8000-000000000001',
        1,
        'default',
        'feed',
        'Out of range'
    ) #>> '{sponsor_selection,items,0,name}' = 'D',
    'out-of-range cursor was not normalized with modulo'
);

UPDATE ap.render_sponsor_scope_memberships
SET ativo = false
WHERE sponsor_id = '00000000-0000-4000-8000-000000000004'
  AND cliente_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  AND template_set = 'default'
  AND content_type = 'feed';

UPDATE ap.render_sponsor_rotation_state
SET current_index = 3
WHERE cliente_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  AND template_set = 'default'
  AND content_type = 'feed';

SELECT pg_temp.assert_true(
    pg_temp.call_rotation(
        '05000000-0000-4000-8000-000000000002',
        1,
        'default',
        'feed',
        'After removal'
    ) #>> '{sponsor_selection,items,0,name}' = 'A',
    'membership removal did not normalize cursor'
);

UPDATE ap.render_sponsor_scope_memberships
SET ativo = true
WHERE sponsor_id = '00000000-0000-4000-8000-000000000004'
  AND cliente_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  AND template_set = 'default'
  AND content_type = 'feed';

UPDATE ap.render_sponsor_scope_memberships
SET ordem = CASE
        WHEN sponsor_id = '00000000-0000-4000-8000-000000000001'
            THEN 99
        WHEN sponsor_id = '00000000-0000-4000-8000-000000000002'
            THEN 0
        WHEN sponsor_id = '00000000-0000-4000-8000-000000000003'
            THEN 1
        ELSE 2
    END
WHERE cliente_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  AND template_set = 'default'
  AND content_type = 'feed';

UPDATE ap.render_sponsor_rotation_state
SET current_index = 0
WHERE cliente_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  AND template_set = 'default'
  AND content_type = 'feed';

SELECT pg_temp.assert_true(
    pg_temp.call_rotation(
        '05000000-0000-4000-8000-000000000003',
        1,
        'default',
        'feed',
        'After order change'
    ) #>> '{sponsor_selection,items,0,name}' = 'B',
    'membership order change was not honored'
);

-- Restore canonical A/B/C/D order for idempotency and rollback tests.
UPDATE ap.render_sponsor_scope_memberships
SET ordem = CASE sponsor_id
        WHEN '00000000-0000-4000-8000-000000000001'::uuid THEN 0
        WHEN '00000000-0000-4000-8000-000000000002'::uuid THEN 1
        WHEN '00000000-0000-4000-8000-000000000003'::uuid THEN 2
        ELSE 3
    END
WHERE cliente_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  AND template_set = 'default'
  AND content_type = 'feed';

-- Idempotent retry returns the same candidate and advances neither queue.
DO $$
DECLARE
    v_first jsonb;
    v_retry jsonb;
    v_sponsor_cursor integer;
    v_template_cursor integer;
    v_template_usage integer;
BEGIN
    v_first := pg_temp.call_rotation(
        '06000000-0000-4000-8000-000000000001',
        1,
        'default',
        'feed',
        'Idempotent request'
    );

    SELECT current_index
    INTO v_sponsor_cursor
    FROM ap.render_sponsor_rotation_state
    WHERE cliente_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      AND template_set = 'default'
      AND content_type = 'feed';

    SELECT current_index
    INTO v_template_cursor
    FROM ap.template_queue_state
    WHERE empresa_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      AND template_set = 'default'
      AND tipo = 'feed';

    SELECT sum(uso_total)
    INTO v_template_usage
    FROM ap.templates
    WHERE empresa_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      AND template_set = 'default'
      AND tipo = 'feed';

    v_retry := pg_temp.call_rotation(
        '06000000-0000-4000-8000-000000000001',
        1,
        'default',
        'feed',
        'Idempotent request'
    );

    PERFORM pg_temp.assert_true(
        (v_retry ->> 'reused')::boolean,
        'retry was not marked reused'
    );
    PERFORM pg_temp.assert_true(
        v_first #>> '{candidate_news,id}' =
        v_retry #>> '{candidate_news,id}',
        'retry returned another candidate'
    );
    PERFORM pg_temp.assert_true(
        v_first -> 'render_snapshot' =
        v_retry -> 'render_snapshot',
        'retry rebuilt immutable snapshot'
    );
    PERFORM pg_temp.assert_true(
        (
            SELECT current_index = v_sponsor_cursor
            FROM ap.render_sponsor_rotation_state
            WHERE cliente_id =
                'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
              AND template_set = 'default'
              AND content_type = 'feed'
        ),
        'retry advanced sponsor cursor'
    );
    PERFORM pg_temp.assert_true(
        (
            SELECT current_index = v_template_cursor
            FROM ap.template_queue_state
            WHERE empresa_id =
                'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
              AND template_set = 'default'
              AND tipo = 'feed'
        ),
        'retry advanced template cursor'
    );
    PERFORM pg_temp.assert_true(
        (
            SELECT sum(uso_total) = v_template_usage
            FROM ap.templates
            WHERE empresa_id =
                'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
              AND template_set = 'default'
              AND tipo = 'feed'
        ),
        'retry incremented template usage'
    );

    BEGIN
        PERFORM pg_temp.call_rotation(
            '06000000-0000-4000-8000-000000000001',
            1,
            'default',
            'feed',
            'Divergent request'
        );
        RAISE EXCEPTION 'expected idempotency mismatch';
    EXCEPTION
        WHEN SQLSTATE '22023' THEN
            IF SQLERRM <> 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH' THEN
                RAISE;
            END IF;
    END;

    PERFORM pg_temp.assert_true(
        (
            SELECT current_index = v_sponsor_cursor
            FROM ap.render_sponsor_rotation_state
            WHERE cliente_id =
                'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
              AND template_set = 'default'
              AND content_type = 'feed'
        ),
        'divergent retry advanced sponsor cursor'
    );
END;
$$;

-- A final insert failure rolls back both template and sponsor mutations.
CREATE OR REPLACE FUNCTION pg_temp.reject_test_candidate()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.titulo = 'FAIL_INSERT' THEN
        RAISE EXCEPTION 'TEST_INSERT_FAILURE';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER test_reject_candidate_insert
BEFORE INSERT ON ap.candidate_news
FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_test_candidate();

DO $$
DECLARE
    v_sponsor_cursor integer;
    v_template_cursor integer;
    v_template_usage integer;
BEGIN
    SELECT current_index
    INTO v_sponsor_cursor
    FROM ap.render_sponsor_rotation_state
    WHERE cliente_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      AND template_set = 'default'
      AND content_type = 'feed';

    SELECT current_index
    INTO v_template_cursor
    FROM ap.template_queue_state
    WHERE empresa_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      AND template_set = 'default'
      AND tipo = 'feed';

    SELECT sum(uso_total)
    INTO v_template_usage
    FROM ap.templates
    WHERE empresa_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      AND template_set = 'default'
      AND tipo = 'feed';

    BEGIN
        PERFORM pg_temp.call_rotation(
            '07000000-0000-4000-8000-000000000001',
            1,
            'default',
            'feed',
            'FAIL_INSERT'
        );
        RAISE EXCEPTION 'expected final insert failure';
    EXCEPTION
        WHEN RAISE_EXCEPTION THEN
            IF SQLERRM <> 'TEST_INSERT_FAILURE' THEN
                RAISE;
            END IF;
    END;

    PERFORM pg_temp.assert_true(
        (
            SELECT current_index = v_sponsor_cursor
            FROM ap.render_sponsor_rotation_state
            WHERE cliente_id =
                'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
              AND template_set = 'default'
              AND content_type = 'feed'
        ),
        'insert failure advanced sponsor cursor'
    );
    PERFORM pg_temp.assert_true(
        (
            SELECT current_index = v_template_cursor
            FROM ap.template_queue_state
            WHERE empresa_id =
                'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
              AND template_set = 'default'
              AND tipo = 'feed'
        ),
        'insert failure advanced template cursor'
    );
    PERFORM pg_temp.assert_true(
        (
            SELECT sum(uso_total) = v_template_usage
            FROM ap.templates
            WHERE empresa_id =
                'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
              AND template_set = 'default'
              AND tipo = 'feed'
        ),
        'insert failure incremented template usage'
    );
END;
$$;

DROP TRIGGER test_reject_candidate_insert ON ap.candidate_news;

-- Catalog constraints and same-client membership ownership.
DO $$
BEGIN
    BEGIN
        INSERT INTO ap.render_sponsors (
            cliente_id,
            nome,
            slug,
            asset_bucket,
            asset_path,
            asset_version,
            sha256
        )
        VALUES (
            'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            'Invalid',
            'Invalid Slug',
            'ap-images',
            'x.png',
            'v1',
            repeat('a', 64)
        );
        RAISE EXCEPTION 'expected normalized slug check';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    BEGIN
        INSERT INTO ap.render_sponsor_scope_memberships (
            sponsor_id,
            cliente_id,
            template_set,
            content_type,
            ordem
        )
        VALUES (
            '00000000-0000-4000-8000-000000000006',
            'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            'default',
            'feed',
            10
        );
        RAISE EXCEPTION 'expected cross-client sponsor FK rejection';
    EXCEPTION
        WHEN foreign_key_violation THEN NULL;
    END;

    BEGIN
        INSERT INTO ap.candidate_news (
            cliente_id,
            status,
            titulo,
            sponsor_count
        )
        VALUES (
            'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            'raw',
            'Invalid count',
            3
        );
        RAISE EXCEPTION 'expected sponsor count check';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;
END;
$$;

-- updated_at trigger preserves created_at and replaces an old updated_at value.
DO $$
DECLARE
    v_created_at timestamptz;
    v_updated_at timestamptz;
BEGIN
    SELECT created_at
    INTO v_created_at
    FROM ap.render_sponsors
    WHERE id = '00000000-0000-4000-8000-000000000001';

    UPDATE ap.render_sponsors
    SET updated_at = '2000-01-01 00:00:00+00'
    WHERE id = '00000000-0000-4000-8000-000000000001';

    UPDATE ap.render_sponsors
    SET nome = 'A updated'
    WHERE id = '00000000-0000-4000-8000-000000000001';

    SELECT updated_at
    INTO v_updated_at
    FROM ap.render_sponsors
    WHERE id = '00000000-0000-4000-8000-000000000001';

    PERFORM pg_temp.assert_true(
        v_updated_at > '2000-01-01 00:00:00+00',
        'updated_at trigger did not run'
    );
    PERFORM pg_temp.assert_true(
        (
            SELECT created_at = v_created_at
            FROM ap.render_sponsors
            WHERE id = '00000000-0000-4000-8000-000000000001'
        ),
        'updated_at trigger changed created_at'
    );
END;
$$;

RESET ROLE;

-- Authenticated tenant A can read/write only tenant A.
SELECT set_config(
    'request.jwt.claims',
    '{"role":"authenticated","sub":"11111111-1111-4111-8111-111111111111"}',
    true
);
SELECT set_config(
    'request.jwt.claim.sub',
    '11111111-1111-4111-8111-111111111111',
    true
);
SET LOCAL ROLE authenticated;

SELECT pg_temp.assert_true(
    (
        SELECT count(*) > 0
        FROM ap.render_sponsors
        WHERE cliente_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    ),
    'authenticated tenant A could not read own sponsors'
);

SELECT pg_temp.assert_true(
    (
        SELECT count(*) = 0
        FROM ap.render_sponsors
        WHERE cliente_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    ),
    'authenticated tenant A read tenant B sponsors'
);

INSERT INTO ap.render_sponsors (
    cliente_id,
    nome,
    slug,
    asset_bucket,
    asset_path,
    asset_version,
    sha256
)
VALUES (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'Tenant A direct',
    'tenant-a-direct',
    'ap-images',
    'sponsors/a/direct.png',
    'direct1',
    repeat('1', 64)
);

DO $$
BEGIN
    BEGIN
        INSERT INTO ap.render_sponsors (
            cliente_id,
            nome,
            slug,
            asset_bucket,
            asset_path,
            asset_version,
            sha256
        )
        VALUES (
            'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            'Forbidden',
            'forbidden',
            'ap-images',
            'sponsors/b/forbidden.png',
            'v1',
            repeat('2', 64)
        );
        RAISE EXCEPTION 'expected cross-tenant RLS rejection';
    EXCEPTION
        WHEN insufficient_privilege THEN NULL;
    END;
END;
$$;

DO $$
DECLARE
    v_result jsonb;
BEGIN
    v_result := ap.create_candidate_with_sponsors(
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        '08000000-0000-4000-8000-000000000001',
        'feed',
        'other',
        1::smallint,
        'Authenticated own client',
        'Content',
        NULL,
        NULL,
        'Category',
        '11111111-1111-4111-8111-111111111111',
        'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        'master_v1',
        '{}'::jsonb
    );

    PERFORM pg_temp.assert_true(
        v_result #>> '{sponsor_selection,items,0,name}' = 'B',
        'authenticated RPC could not create for own client'
    );

    BEGIN
        PERFORM ap.create_candidate_with_sponsors(
            'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            '08000000-0000-4000-8000-000000000002',
            'feed',
            'default',
            0::smallint,
            'Forbidden other client',
            'Content',
            NULL,
            NULL,
            'Category',
            '11111111-1111-4111-8111-111111111111',
            NULL,
            'legacy',
            '{}'::jsonb
        );
        RAISE EXCEPTION 'expected RPC client authorization failure';
    EXCEPTION
        WHEN insufficient_privilege THEN
            IF SQLERRM <> 'CLIENT_ACCESS_DENIED' THEN
                RAISE;
            END IF;
    END;
END;
$$;

RESET ROLE;

-- Anon has neither grants nor a policy.
SELECT pg_temp.assert_true(
    NOT has_table_privilege(
        'anon',
        'ap.render_sponsors',
        'SELECT'
    ),
    'anon unexpectedly has SELECT grant'
);

SET LOCAL ROLE anon;
DO $$
BEGIN
    BEGIN
        PERFORM count(*) FROM ap.render_sponsors;
        RAISE EXCEPTION 'anon unexpectedly read sponsors';
    EXCEPTION
        WHEN insufficient_privilege THEN NULL;
    END;
END;
$$;
RESET ROLE;

-- service_role remains compatible and the privileged RPC is not public/anon.
SELECT set_config(
    'request.jwt.claims',
    '{"role":"service_role","sub":"11111111-1111-4111-8111-111111111111"}',
    true
);
SET LOCAL ROLE service_role;

SELECT pg_temp.assert_true(
    (SELECT count(*) FROM ap.render_sponsors) > 0,
    'service_role could not read sponsor catalog'
);

RESET ROLE;

SELECT pg_temp.assert_true(
    NOT has_function_privilege(
        'anon',
        'ap.create_candidate_with_sponsors(uuid,uuid,text,text,smallint,text,text,text,text,text,uuid,uuid,text,jsonb)',
        'EXECUTE'
    ),
    'anon can execute privileged candidate RPC'
);

SELECT pg_temp.assert_true(
    has_function_privilege(
        'authenticated',
        'ap.create_candidate_with_sponsors(uuid,uuid,text,text,smallint,text,text,text,text,text,uuid,uuid,text,jsonb)',
        'EXECUTE'
    ),
    'authenticated lacks RPC execute grant'
);

SELECT pg_temp.assert_true(
    has_function_privilege(
        'service_role',
        'ap.create_candidate_with_sponsors(uuid,uuid,text,text,smallint,text,text,text,text,text,uuid,uuid,text,jsonb)',
        'EXECUTE'
    ),
    'service_role lacks RPC execute grant'
);

-- Legacy structures remain structurally intact.
SELECT pg_temp.assert_true(
    (
        SELECT count(*) = 9
        FROM information_schema.columns
        WHERE table_schema = 'ap'
          AND table_name = 'patrocinadores'
    ),
    'ap.patrocinadores structure changed'
);

SELECT pg_temp.assert_true(
    to_regprocedure('ap.select_sponsor(uuid)') IS NOT NULL,
    'ap.select_sponsor was removed'
);

SELECT pg_temp.assert_true(
    to_regprocedure(
        'ap.get_and_advance_template(uuid,text,text)'
    ) IS NOT NULL,
    'template rotation RPC was removed'
);

SELECT pg_temp.assert_true(
    (
        SELECT count(*) = 0
        FROM information_schema.columns
        WHERE table_schema = 'ap'
          AND table_name = 'patrocinadores'
          AND column_name IN (
              'asset_bucket',
              'asset_path',
              'asset_version',
              'sha256'
          )
    ),
    'new catalog fields leaked into ap.patrocinadores'
);

ROLLBACK;

\echo 'sponsor-rotation-contract.sql: PASS'
