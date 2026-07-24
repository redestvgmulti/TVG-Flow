\set ON_ERROR_STOP on

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.assert_true(
    condition boolean,
    message text
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
    IF NOT COALESCE(condition, false) THEN
        RAISE EXCEPTION 'assertion failed: %', message;
    END IF;
END;
$$;

-- Fixtures: both tenants must exist so the cliente_id foreign keys on templates,
-- render_sponsors, visual_title_groups and visual_titles resolve. The RPC calls
-- below run with a service_role JWT claim, so no cliente_profissionais link is
-- required for the client-access check.
INSERT INTO public.clientes (id, nome)
VALUES
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Client A'),
    ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Client B')
ON CONFLICT (id) DO NOTHING;

INSERT INTO ap.templates (
    id,
    empresa_id,
    placid_template_uuid,
    nome,
    ordem,
    ativo,
    tipo,
    template_set
)
VALUES (
    '10000000-0000-4000-8000-000000000001',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'placid-feed-default',
    'Feed default',
    1,
    true,
    'feed',
    'default'
);

INSERT INTO ap.render_sponsors (
    id,
    cliente_id,
    nome,
    slug,
    asset_bucket,
    asset_path,
    asset_version,
    sha256
)
VALUES (
    '20000000-0000-4000-8000-000000000001',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'Sponsor A',
    'sponsor-a',
    'ap-images',
    'sponsors/a/sponsor-a/hash.png',
    'v1',
    repeat('1', 64)
);

INSERT INTO ap.render_sponsor_scope_memberships (
    id,
    sponsor_id,
    cliente_id,
    template_set,
    content_type,
    ordem
)
VALUES (
    '30000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'default',
    'feed',
    0
);

INSERT INTO ap.visual_title_groups (
    id,
    cliente_id,
    nome,
    slug,
    ativo
)
VALUES
    (
        '40000000-0000-4000-8000-000000000001',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'Cidades',
        'cidades',
        true
    ),
    (
        '40000000-0000-4000-8000-000000000002',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'Arquivado',
        'arquivado',
        false
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
VALUES
    (
        '50000000-0000-4000-8000-000000000001',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        '40000000-0000-4000-8000-000000000001',
        'Goiatuba',
        'goiatuba',
        'ap-images',
        'visual-titles/a/goiatuba/hash.png',
        'v1',
        repeat('a', 64),
        ARRAY['feed']::text[],
        true,
        0
    ),
    (
        '50000000-0000-4000-8000-000000000002',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        '40000000-0000-4000-8000-000000000002',
        'Arquivado',
        'selo-arquivado',
        'ap-images',
        'visual-titles/a/arquivado/hash.png',
        'v1',
        repeat('b', 64),
        ARRAY['feed']::text[],
        true,
        1
    ),
    (
        '50000000-0000-4000-8000-000000000003',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        NULL,
        'Legado',
        'legado',
        'ap-images',
        'visual-titles/a/legado/hash.png',
        'v1',
        repeat('c', 64),
        ARRAY['feed', 'reels']::text[],
        true,
        2
    ),
    (
        '50000000-0000-4000-8000-000000000004',
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        NULL,
        'Outro cliente',
        'outro-cliente',
        'ap-images',
        'visual-titles/b/outro/hash.png',
        'v1',
        repeat('d', 64),
        ARRAY['feed']::text[],
        true,
        0
    );

SELECT set_config(
    'request.jwt.claims',
    '{"role":"service_role","sub":"11111111-1111-4111-8111-111111111111"}',
    true
);

DO $$
DECLARE
    v_result jsonb;
BEGIN
    v_result := ap.create_candidate_with_sponsors(
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        '60000000-0000-4000-8000-000000000001',
        'feed',
        'default',
        1::smallint,
        'Matéria com grupo',
        'Conteúdo',
        NULL,
        NULL,
        'Cidades',
        NULL,
        '50000000-0000-4000-8000-000000000001',
        'master_v1',
        '{"master_config":{"master_template_uuid":"master-feed"}}'::jsonb
    );

    PERFORM pg_temp.assert_true(
        v_result #>> '{render_snapshot,visual_title,id}'
            = '50000000-0000-4000-8000-000000000001',
        'visual title id was not frozen'
    );
    PERFORM pg_temp.assert_true(
        v_result #>> '{render_snapshot,visual_title,path}'
            = 'visual-titles/a/goiatuba/hash.png',
        'visual title asset path was not frozen'
    );
    PERFORM pg_temp.assert_true(
        v_result #>> '{render_snapshot,visual_title,group_id}'
            = '40000000-0000-4000-8000-000000000001',
        'group id was not frozen'
    );
    PERFORM pg_temp.assert_true(
        v_result #>> '{render_snapshot,visual_title,group_name_at_selection}'
            = 'Cidades',
        'group name was not frozen'
    );
END;
$$;

DO $$
DECLARE
    v_result jsonb;
BEGIN
    v_result := ap.create_candidate_with_sponsors(
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        '60000000-0000-4000-8000-000000000002',
        'feed',
        'default',
        0::smallint,
        'Matéria legado sem grupo',
        'Conteúdo',
        NULL,
        NULL,
        'Legado',
        NULL,
        '50000000-0000-4000-8000-000000000003',
        'master_v1',
        '{}'::jsonb
    );

    PERFORM pg_temp.assert_true(
        (v_result #> '{render_snapshot,visual_title}') ? 'group_id',
        'legacy title did not receive explicit null group metadata'
    );
    PERFORM pg_temp.assert_true(
        v_result #> '{render_snapshot,visual_title,group_id}' = 'null'::jsonb,
        'legacy title group id is not null'
    );
END;
$$;

DO $$
DECLARE
    v_template_usage integer;
    v_template_cursor integer;
    v_sponsor_cursor integer;
BEGIN
    SELECT uso_total
    INTO v_template_usage
    FROM ap.templates
    WHERE id = '10000000-0000-4000-8000-000000000001';

    SELECT current_index
    INTO v_template_cursor
    FROM ap.template_queue_state
    WHERE empresa_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      AND tipo = 'feed'
      AND template_set = 'default';

    SELECT current_index
    INTO v_sponsor_cursor
    FROM ap.render_sponsor_rotation_state
    WHERE cliente_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      AND content_type = 'feed'
      AND template_set = 'default';

    BEGIN
        PERFORM ap.create_candidate_with_sponsors(
            'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            '60000000-0000-4000-8000-000000000003',
            'feed',
            'default',
            1::smallint,
            'Grupo arquivado',
            'Conteúdo',
            NULL,
            NULL,
            'Arquivo',
            NULL,
            '50000000-0000-4000-8000-000000000002',
            'master_v1',
            '{}'::jsonb
        );
        RAISE EXCEPTION 'expected inactive group rejection';
    EXCEPTION
        WHEN SQLSTATE '22023' THEN
            IF SQLERRM <> 'VISUAL_TITLE_GROUP_INACTIVE' THEN
                RAISE;
            END IF;
    END;

    PERFORM pg_temp.assert_true(
        NOT EXISTS (
            SELECT 1
            FROM ap.candidate_news
            WHERE idempotency_key =
                '60000000-0000-4000-8000-000000000003'
        ),
        'inactive group created candidate_news'
    );
    PERFORM pg_temp.assert_true(
        (SELECT uso_total FROM ap.templates
         WHERE id = '10000000-0000-4000-8000-000000000001')
            = v_template_usage,
        'inactive group advanced template usage'
    );
    PERFORM pg_temp.assert_true(
        (SELECT current_index FROM ap.template_queue_state
         WHERE empresa_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
           AND tipo = 'feed'
           AND template_set = 'default')
            IS NOT DISTINCT FROM v_template_cursor,
        'inactive group advanced template cursor'
    );
    PERFORM pg_temp.assert_true(
        (SELECT current_index FROM ap.render_sponsor_rotation_state
         WHERE cliente_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
           AND content_type = 'feed'
           AND template_set = 'default')
            IS NOT DISTINCT FROM v_sponsor_cursor,
        'inactive group advanced sponsor cursor'
    );
END;
$$;

DO $$
BEGIN
    BEGIN
        PERFORM ap.create_candidate_with_sponsors(
            'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            '60000000-0000-4000-8000-000000000004',
            'feed',
            'default',
            0::smallint,
            'Selo de outro cliente',
            'Conteúdo',
            NULL,
            NULL,
            'Teste',
            NULL,
            '50000000-0000-4000-8000-000000000004',
            'master_v1',
            '{}'::jsonb
        );
        RAISE EXCEPTION 'expected cross-client title rejection';
    EXCEPTION
        WHEN SQLSTATE '22023' THEN
            IF SQLERRM <> 'VISUAL_TITLE_NOT_FOUND' THEN
                RAISE;
            END IF;
    END;
END;
$$;

DO $$
DECLARE
    v_first jsonb;
    v_retry jsonb;
    v_snapshot jsonb;
    v_usage integer;
    v_template_cursor integer;
    v_sponsor_cursor integer;
BEGIN
    v_first := ap.create_candidate_with_sponsors(
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        '60000000-0000-4000-8000-000000000005',
        'feed',
        'default',
        1::smallint,
        'Retry imutável',
        'Conteúdo',
        NULL,
        NULL,
        'Cidades',
        NULL,
        '50000000-0000-4000-8000-000000000001',
        'master_v1',
        '{
          "master_config":{"master_template_uuid":"master-feed-original"},
          "layer_map":{"headline":"headline_news"}
        }'::jsonb
    );
    v_snapshot := v_first -> 'render_snapshot';

    UPDATE ap.visual_title_groups
    SET nome = 'Cidades renomeadas',
        slug = 'cidades-renomeadas',
        ativo = false
    WHERE id = '40000000-0000-4000-8000-000000000001';

    UPDATE ap.visual_titles
    SET asset_path = 'visual-titles/a/goiatuba/new-hash.png',
        asset_version = 'v2',
        sha256 = repeat('e', 64)
    WHERE id = '50000000-0000-4000-8000-000000000001';

    UPDATE ap.render_sponsors
    SET ativo = false,
        asset_path = 'sponsors/a/sponsor-a/new-hash.png',
        asset_version = 'v2',
        sha256 = repeat('f', 64)
    WHERE id = '20000000-0000-4000-8000-000000000001';

    SELECT uso_total
    INTO v_usage
    FROM ap.templates
    WHERE id = '10000000-0000-4000-8000-000000000001';
    SELECT current_index
    INTO v_template_cursor
    FROM ap.template_queue_state
    WHERE empresa_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      AND tipo = 'feed'
      AND template_set = 'default';
    SELECT current_index
    INTO v_sponsor_cursor
    FROM ap.render_sponsor_rotation_state
    WHERE cliente_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      AND content_type = 'feed'
      AND template_set = 'default';

    v_retry := ap.create_candidate_with_sponsors(
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        '60000000-0000-4000-8000-000000000005',
        'feed',
        'default',
        1::smallint,
        'Retry imutável',
        'Conteúdo',
        NULL,
        NULL,
        'Cidades',
        NULL,
        '50000000-0000-4000-8000-000000000001',
        'master_v1',
        '{
          "master_config":{"master_template_uuid":"master-feed-changed"},
          "layer_map":{"headline":"changed-live-layer"}
        }'::jsonb
    );

    PERFORM pg_temp.assert_true(
        (v_retry ->> 'reused')::boolean,
        'retry did not reuse existing candidate'
    );
    PERFORM pg_temp.assert_true(
        v_retry -> 'render_snapshot' = v_snapshot,
        'retry rebuilt immutable snapshot'
    );
    PERFORM pg_temp.assert_true(
        v_retry #>> '{render_snapshot,visual_title,group_name_at_selection}'
            = 'Cidades',
        'retry used current group name'
    );
    PERFORM pg_temp.assert_true(
        v_retry #>> '{render_snapshot,visual_title,path}'
            = 'visual-titles/a/goiatuba/hash.png',
        'retry used current asset path'
    );
    PERFORM pg_temp.assert_true(
        v_retry #>> '{render_snapshot,master_config,master_template_uuid}'
            = 'master-feed-original',
        'retry used current master UUID'
    );
    PERFORM pg_temp.assert_true(
        v_retry #>> '{render_snapshot,layer_map,headline}'
            = 'headline_news',
        'retry used current layer map'
    );
    PERFORM pg_temp.assert_true(
        v_retry #>> '{render_snapshot,sponsor_selection,items,0,path}'
            = 'sponsors/a/sponsor-a/hash.png',
        'retry used current sponsor asset'
    );
    PERFORM pg_temp.assert_true(
        (SELECT uso_total FROM ap.templates
         WHERE id = '10000000-0000-4000-8000-000000000001')
            = v_usage,
        'retry advanced template usage'
    );
    PERFORM pg_temp.assert_true(
        (SELECT current_index FROM ap.template_queue_state
         WHERE empresa_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
           AND tipo = 'feed'
           AND template_set = 'default')
            = v_template_cursor,
        'retry advanced template cursor'
    );
    PERFORM pg_temp.assert_true(
        (SELECT current_index FROM ap.render_sponsor_rotation_state
         WHERE cliente_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
           AND content_type = 'feed'
           AND template_set = 'default')
            = v_sponsor_cursor,
        'retry advanced sponsor cursor'
    );

    BEGIN
        PERFORM ap.create_candidate_with_sponsors(
            'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            '60000000-0000-4000-8000-000000000005',
            'feed',
            'default',
            2::smallint,
            'Retry imutável',
            'Conteúdo',
            NULL,
            NULL,
            'Cidades',
            NULL,
            '50000000-0000-4000-8000-000000000001',
            'master_v1',
            '{}'::jsonb
        );
        RAISE EXCEPTION 'expected semantic payload mismatch';
    EXCEPTION
        WHEN SQLSTATE '22023' THEN
            IF SQLERRM <> 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH' THEN
                RAISE;
            END IF;
    END;

    PERFORM pg_temp.assert_true(
        v_snapshot #>> '{idempotency,request_fingerprint}' IS NOT NULL,
        'new candidate did not persist a request fingerprint'
    );
    PERFORM pg_temp.assert_true(
        v_snapshot #> '{idempotency,semantic_request,master_config}' IS NULL,
        'semantic request contains live master configuration'
    );

    BEGIN
        PERFORM ap.create_candidate_with_sponsors(
            'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            '60000000-0000-4000-8000-000000000006',
            'feed',
            'default',
            1::smallint,
            'Nova após arquivamento',
            'Conteúdo',
            NULL,
            NULL,
            'Cidades',
            NULL,
            '50000000-0000-4000-8000-000000000001',
            'master_v1',
            '{}'::jsonb
        );
        RAISE EXCEPTION 'expected new request to reject archived group';
    EXCEPTION
        WHEN SQLSTATE '22023' THEN
            IF SQLERRM <> 'VISUAL_TITLE_GROUP_INACTIVE' THEN
                RAISE;
            END IF;
    END;
END;
$$;

SELECT pg_temp.assert_true(
    has_function_privilege(
        'authenticated',
        'ap.create_candidate_with_sponsors(uuid,uuid,text,text,smallint,text,text,text,text,text,uuid,uuid,text,jsonb)',
        'EXECUTE'
    ),
    'authenticated lost wrapper execute grant'
);
SELECT pg_temp.assert_true(
    NOT has_function_privilege(
        'authenticated',
        'ap.create_candidate_with_sponsors_core_v1(uuid,uuid,text,text,smallint,text,text,text,text,text,uuid,uuid,text,jsonb)',
        'EXECUTE'
    ),
    'authenticated can bypass group validation through core'
);
SELECT pg_temp.assert_true(
    NOT has_function_privilege(
        'anon',
        'ap.create_candidate_with_sponsors(uuid,uuid,text,text,smallint,text,text,text,text,text,uuid,uuid,text,jsonb)',
        'EXECUTE'
    ),
    'anon can execute candidate wrapper'
);

ROLLBACK;

\echo 'visual-title-group-snapshot-contract.sql: PASS'
