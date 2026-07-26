\set ON_ERROR_STOP on

-- End-to-end AutoPublisher flow against the fully migrated local schema. Two
-- tenants are provisioned, a feed and a story master are configured, sponsors
-- and visual-title groups are registered, a candidate is generated, its snapshot
-- is proven immutable across a live configuration change and a failed retry, and
-- tenant/storage isolation is verified. Everything runs in one transaction that
-- is rolled back at the end (reliable cleanup).

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.assert_true(p_condition boolean, p_message text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF NOT COALESCE(p_condition, false) THEN
        RAISE EXCEPTION 'E2E_FAILED: %', p_message;
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.assert_raises(p_sql text, p_state text, p_message text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_raised boolean := false;
BEGIN
    BEGIN EXECUTE p_sql;
    EXCEPTION WHEN OTHERS THEN
        v_raised := true;
        IF SQLSTATE <> p_state THEN
            RAISE EXCEPTION 'E2E_FAILED: %, got SQLSTATE %, expected %', p_message, SQLSTATE, p_state;
        END IF;
    END;
    IF NOT v_raised THEN
        RAISE EXCEPTION 'E2E_FAILED: %', p_message;
    END IF;
END;
$$;

-- Stable identifiers for the run.
\set A '''aaaaaaaa-0000-4e2e-8000-00000000000a'''
\set B '''bbbbbbbb-0000-4e2e-8000-00000000000b'''
\set UA '''11111111-0000-4e2e-8000-0000000000a1'''

-- 1. Two tenants.
INSERT INTO public.clientes (id, nome) VALUES
    (:A, 'E2E Tenant A'), (:B, 'E2E Tenant B');

-- 2. A user linked to tenant A (the provisioning trigger fills profissionais).
INSERT INTO auth.users (id, email) VALUES (:UA, 'e2e-user-a@test.local');
INSERT INTO public.cliente_profissionais (cliente_id, profissional_id, funcao, ativo)
VALUES (:A, :UA, 'editor', true);

-- 3. Feed master (tvg visual model).
INSERT INTO ap.master_render_configs (cliente_id, content_type, visual_model, master_template_uuid, enabled, layer_map)
VALUES (:A, 'feed', 'tvg', 'master-feed-original', true,
        '{"visual_title":"tag-png","sponsor_1":"patrocinador-1"}'::jsonb);

-- 4. Story (reels) master (tvg visual model).
INSERT INTO ap.master_render_configs (cliente_id, content_type, visual_model, master_template_uuid, enabled, layer_map)
VALUES (:A, 'reels', 'tvg', 'master-reels-original', true,
        '{"visual_title":"tag-png"}'::jsonb);

-- 5. Exactly one master per (cliente, format, visual_model): repeating the same
--    triple is rejected, while the other model of the same format is accepted.
SELECT pg_temp.assert_raises(
    format($$INSERT INTO ap.master_render_configs (cliente_id, content_type, visual_model, enabled)
             VALUES (%L,'feed','tvg',true)$$, :A),
    '23505',
    'a second feed/tvg master was accepted for one tenant'
);
INSERT INTO ap.master_render_configs (cliente_id, content_type, visual_model, master_template_uuid, enabled, layer_map)
VALUES (:A, 'feed', 'misto', 'master-feed-misto', true,
        '{"visual_title":"tag-png","sponsor_1":"patrocinador-1"}'::jsonb);
SELECT pg_temp.assert_true(
    (SELECT count(*) = 2 FROM ap.master_render_configs WHERE cliente_id = :A AND content_type='feed' AND enabled),
    'tenant A does not have both enabled feed visual models'
);
SELECT pg_temp.assert_true(
    (SELECT count(*) = 1 FROM ap.master_render_configs
     WHERE cliente_id = :A AND content_type='feed' AND visual_model='tvg' AND enabled),
    'tenant A does not have exactly one enabled feed/tvg master'
);
SELECT pg_temp.assert_true(
    (SELECT count(*) = 1 FROM ap.master_render_configs
     WHERE cliente_id = :A AND content_type='reels' AND visual_model='tvg' AND enabled),
    'tenant A does not have exactly one enabled reels/tvg master'
);

-- 6. Sponsors and their feed/default rotation membership.
INSERT INTO ap.render_sponsors (id, cliente_id, nome, slug, asset_bucket, asset_path, asset_version, sha256, ativo)
VALUES ('50000000-0000-4e2e-8000-000000000001', :A, 'Sponsor A', 'sponsor-a', 'ap-images',
        'sponsors/a/sponsor-a/hash.png', 'v1', repeat('1', 64), true);
INSERT INTO ap.render_sponsor_scope_memberships (sponsor_id, cliente_id, template_set, content_type, ordem)
VALUES ('50000000-0000-4e2e-8000-000000000001', :A, 'default', 'feed', 0);

-- 7. Visual-title group.
INSERT INTO ap.visual_title_groups (id, cliente_id, nome, slug)
VALUES ('60000000-0000-4e2e-8000-000000000001', :A, 'Cidades', 'cidades');

-- 8. A visual title associated to that group (tenant A path).
INSERT INTO ap.visual_titles (id, cliente_id, group_id, nome, slug, asset_bucket, asset_path, asset_version, sha256, formatos, ativo, ordem)
VALUES ('70000000-0000-4e2e-8000-000000000001', :A, '60000000-0000-4e2e-8000-000000000001',
        'Goiatuba', 'goiatuba', 'ap-images', 'visual-titles/a/goiatuba/hash.png', 'v1', repeat('a', 64),
        ARRAY['feed']::text[], true, 0);

-- A feed template for the rotation to advance.
INSERT INTO ap.templates (id, empresa_id, placid_template_uuid, nome, ordem, ativo, tipo, template_set)
VALUES ('80000000-0000-4e2e-8000-000000000001', :A, 'placid-feed', 'Feed default', 1, true, 'feed', 'default');

-- Act as the tenant's authenticated identity for generation.
SELECT set_config('request.jwt.claims',
    format('{"role":"service_role","sub":%s}', to_json(:UA::text)), true);

-- 9. Generate a candidate. 10. Capture and validate the immutable snapshot.
DO $$
DECLARE v_result jsonb; v_snapshot jsonb;
BEGIN
    v_result := ap.create_candidate_with_sponsors(
        'aaaaaaaa-0000-4e2e-8000-00000000000a', '90000000-0000-4e2e-8000-000000000001',
        'feed', 'default', 1::smallint, 'Matéria E2E', 'Conteúdo', NULL, NULL, 'Cidades',
        '11111111-0000-4e2e-8000-0000000000a1', '70000000-0000-4e2e-8000-000000000001',
        'master_v1', '{"master_config":{"master_template_uuid":"master-feed-original"}}'::jsonb
    );
    v_snapshot := v_result -> 'render_snapshot';

    PERFORM pg_temp.assert_true((v_result ->> 'reused')::boolean IS NOT TRUE,
        'first generation should not be a reuse');
    PERFORM pg_temp.assert_true(
        v_snapshot #>> '{visual_title,id}' = '70000000-0000-4e2e-8000-000000000001',
        'snapshot did not freeze the visual title');
    PERFORM pg_temp.assert_true(
        v_snapshot #>> '{visual_title,path}' = 'visual-titles/a/goiatuba/hash.png',
        'snapshot did not freeze the visual-title asset path');
    PERFORM pg_temp.assert_true(
        v_snapshot #>> '{sponsor_selection,items,0,path}' = 'sponsors/a/sponsor-a/hash.png',
        'snapshot did not freeze the sponsor asset');
    PERFORM pg_temp.assert_true(
        v_snapshot #>> '{master_config,master_template_uuid}' = 'master-feed-original',
        'snapshot did not freeze the master template uuid');
END;
$$;

-- 11. Mutate the live configuration after generation.
UPDATE ap.master_render_configs SET master_template_uuid = 'master-feed-CHANGED'
    WHERE cliente_id = 'aaaaaaaa-0000-4e2e-8000-00000000000a'
      AND content_type = 'feed' AND visual_model = 'tvg';
UPDATE ap.visual_titles SET asset_path = 'visual-titles/a/goiatuba/NEW.png', asset_version = 'v2'
    WHERE id = '70000000-0000-4e2e-8000-000000000001';
UPDATE ap.render_sponsors SET asset_path = 'sponsors/a/sponsor-a/NEW.png', ativo = false
    WHERE id = '50000000-0000-4e2e-8000-000000000001';

-- 13. Simulate a render failure on the candidate before retrying.
UPDATE ap.candidate_news SET status = 'failed'
    WHERE idempotency_key = '90000000-0000-4e2e-8000-000000000001';

-- 12. Retry with the same idempotency key reuses the ORIGINAL frozen snapshot,
--     ignoring every live change above.
DO $$
DECLARE v_retry jsonb;
BEGIN
    v_retry := ap.create_candidate_with_sponsors(
        'aaaaaaaa-0000-4e2e-8000-00000000000a', '90000000-0000-4e2e-8000-000000000001',
        'feed', 'default', 1::smallint, 'Matéria E2E', 'Conteúdo', NULL, NULL, 'Cidades',
        '11111111-0000-4e2e-8000-0000000000a1', '70000000-0000-4e2e-8000-000000000001',
        'master_v1', '{"master_config":{"master_template_uuid":"master-feed-original"}}'::jsonb
    );
    PERFORM pg_temp.assert_true((v_retry ->> 'reused')::boolean,
        'retry after failure did not reuse the candidate');
    PERFORM pg_temp.assert_true(
        v_retry #>> '{render_snapshot,master_config,master_template_uuid}' = 'master-feed-original',
        'retry used the changed master instead of the frozen snapshot');
    PERFORM pg_temp.assert_true(
        v_retry #>> '{render_snapshot,visual_title,path}' = 'visual-titles/a/goiatuba/hash.png',
        'retry used the changed visual-title asset instead of the frozen snapshot');
    PERFORM pg_temp.assert_true(
        v_retry #>> '{render_snapshot,sponsor_selection,items,0,path}' = 'sponsors/a/sponsor-a/hash.png',
        'retry used the changed sponsor asset instead of the frozen snapshot');
END;
$$;

-- 14. Tenant isolation: an authenticated tenant-A session sees only tenant A, and
--     a cross-tenant visual title is rejected by the generator.
SAVEPOINT tenant_isolation;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '11111111-0000-4e2e-8000-0000000000a1', true);
SELECT pg_temp.assert_true(
    (SELECT count(*) = 0 FROM ap.candidate_news WHERE cliente_id = 'bbbbbbbb-0000-4e2e-8000-00000000000b'),
    'tenant A session can read tenant B candidates');
SELECT pg_temp.assert_true(
    (SELECT count(*) >= 1 FROM ap.candidate_news WHERE cliente_id = 'aaaaaaaa-0000-4e2e-8000-00000000000a'),
    'tenant A session cannot read its own candidates');
RESET ROLE;
ROLLBACK TO SAVEPOINT tenant_isolation;

SELECT set_config('request.jwt.claims',
    '{"role":"service_role","sub":"11111111-0000-4e2e-8000-0000000000a1"}', true);
SELECT pg_temp.assert_raises(
    $$SELECT ap.create_candidate_with_sponsors(
        'bbbbbbbb-0000-4e2e-8000-00000000000b','91000000-0000-4e2e-8000-000000000001',
        'feed','default',0::smallint,'Cross','x',NULL,NULL,'Cidades',NULL,
        '70000000-0000-4e2e-8000-000000000001','master_v1','{}'::jsonb)$$,
    '22023',
    'a tenant B candidate accepted a tenant A visual title');

-- 15. Storage paths: tenant A writes its own immutable asset; tenant B path denied.
SAVEPOINT storage_paths;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '11111111-0000-4e2e-8000-0000000000a1', true);
INSERT INTO storage.objects (bucket_id, name)
VALUES ('ap-images', 'sponsors/aaaaaaaa-0000-4e2e-8000-00000000000a/acme/' || repeat('a', 64) || '.png');
SELECT pg_temp.assert_raises(
    $$INSERT INTO storage.objects (bucket_id, name)
      VALUES ('ap-images','sponsors/bbbbbbbb-0000-4e2e-8000-00000000000b/acme/' || repeat('c',64) || '.png')$$,
    '42501',
    'tenant A wrote a storage asset into tenant B path');
RESET ROLE;
ROLLBACK TO SAVEPOINT storage_paths;

-- 16. Cleanup.
ROLLBACK;

\echo 'autopublisher-e2e.sql: PASS'
