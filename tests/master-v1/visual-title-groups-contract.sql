\set ON_ERROR_STOP on

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

CREATE OR REPLACE FUNCTION pg_temp.assert_raises(
    p_sql text,
    p_expected_state text,
    p_message text
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    v_raised boolean := false;
BEGIN
    BEGIN
        EXECUTE p_sql;
    EXCEPTION WHEN OTHERS THEN
        v_raised := true;
        IF SQLSTATE <> p_expected_state THEN
            RAISE EXCEPTION 'ASSERTION_FAILED: %, got SQLSTATE %, expected %',
                p_message, SQLSTATE, p_expected_state;
        END IF;
    END;

    IF NOT v_raised THEN
        RAISE EXCEPTION 'ASSERTION_FAILED: %', p_message;
    END IF;
END;
$$;

-- The original two titles receive a normal, editable Geral group; the client
-- without titles receives no synthetic group.
SELECT pg_temp.assert_true(
    (SELECT count(*) = 2 FROM ap.visual_title_groups WHERE nome = 'Geral'),
    'backfill created Geral exactly for clients with legacy titles'
);
SELECT pg_temp.assert_true(
    (SELECT count(*) = 0 FROM ap.visual_title_groups
     WHERE cliente_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
    'backfill created Geral for a client without titles'
);
SELECT pg_temp.assert_true(
    (SELECT group_id IS NOT NULL FROM ap.visual_titles
     WHERE id = 'd0000000-0000-4000-8000-000000000001'),
    'backfill did not assign a group to the first legacy title'
);
SELECT pg_temp.assert_true(
    (SELECT asset_bucket = 'ap-images'
        AND asset_path = 'visual-titles/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/esporte/a.png'
        AND asset_version = 'version-a'
        AND sha256 = repeat('a', 64)
        AND ordem = 3
        AND ativo
     FROM ap.visual_titles
     WHERE id = 'd0000000-0000-4000-8000-000000000001'),
    'backfill changed legacy visual-title asset metadata'
);

-- Schema, defaults, indexes and trigger.
SELECT pg_temp.assert_true(
    EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'ap' AND table_name = 'visual_title_groups'
          AND column_name = 'descricao' AND is_nullable = 'YES'
    ),
    'visual_title_groups.descricao is missing or not nullable'
);
SELECT pg_temp.assert_true(
    EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'ap' AND table_name = 'visual_titles'
          AND column_name = 'group_id' AND is_nullable = 'YES'
    ),
    'visual_titles.group_id is missing or not nullable during compatibility rollout'
);
SELECT pg_temp.assert_true(
    to_regclass('ap.idx_visual_title_groups_cliente_active_ordem') IS NOT NULL
    AND to_regclass('ap.idx_visual_titles_cliente_group_active_ordem') IS NOT NULL,
    'required group lookup indexes are missing'
);
SELECT pg_temp.assert_true(
    EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgrelid = 'ap.visual_title_groups'::regclass
          AND tgname = 'trg_ap_visual_title_groups_updated_at'
          AND NOT tgisinternal
    ),
    'updated_at trigger is missing from visual_title_groups'
);

INSERT INTO ap.visual_title_groups (id, cliente_id, nome, slug, descricao, ordem)
VALUES (
    'e0000000-0000-4000-8000-000000000001',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'Cidades',
    'cidades',
    'Grupo de cidades',
    2
);

CREATE TEMP TABLE group_audit_time AS
SELECT id, created_at, updated_at
FROM ap.visual_title_groups
WHERE id = 'e0000000-0000-4000-8000-000000000001';

SELECT pg_sleep(0.01);
UPDATE ap.visual_title_groups
SET descricao = 'Grupo de cidades atualizado'
WHERE id = 'e0000000-0000-4000-8000-000000000001';

SELECT pg_temp.assert_true(
    EXISTS (
        SELECT 1
        FROM ap.visual_title_groups g
        JOIN group_audit_time before_update USING (id)
        WHERE g.created_at = before_update.created_at
          AND g.updated_at > before_update.updated_at
    ),
    'updated_at trigger did not update updated_at while preserving created_at'
);

-- Group constraints.
SELECT pg_temp.assert_raises(
    $$INSERT INTO ap.visual_title_groups (cliente_id,nome,slug)
      VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','','empty-name')$$,
    '23514',
    'empty group name was accepted'
);
SELECT pg_temp.assert_raises(
    $$INSERT INTO ap.visual_title_groups (cliente_id,nome,slug)
      VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Nome','')$$,
    '23514',
    'empty group slug was accepted'
);
SELECT pg_temp.assert_raises(
    $$INSERT INTO ap.visual_title_groups (cliente_id,nome,slug)
      VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Nome','Upper')$$,
    '23514',
    'non-normalized group slug was accepted'
);
SELECT pg_temp.assert_raises(
    $$INSERT INTO ap.visual_title_groups (cliente_id,nome,slug,ordem)
      VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Nome','negative',-1)$$,
    '23514',
    'negative group order was accepted'
);
SELECT pg_temp.assert_raises(
    $$INSERT INTO ap.visual_title_groups (cliente_id,nome,slug)
      VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Outra cidade','cidades')$$,
    '23505',
    'duplicate group slug for one client was accepted'
);
INSERT INTO ap.visual_title_groups (id, cliente_id, nome, slug)
VALUES (
    'e0000000-0000-4000-8000-000000000002',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'Cidades',
    'cidades'
);

-- The composite FK preserves tenant isolation structurally.
INSERT INTO ap.visual_titles (
    id, cliente_id, nome, slug, asset_bucket, asset_path, asset_version, sha256,
    formatos, group_id
)
VALUES (
    'd0000000-0000-4000-8000-000000000003',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'Goiatuba',
    'goiatuba',
    'ap-images',
    'visual-titles/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/goiatuba/c.png',
    'version-c',
    repeat('c', 64),
    ARRAY['feed']::text[],
    'e0000000-0000-4000-8000-000000000001'
);
SELECT pg_temp.assert_raises(
    $$INSERT INTO ap.visual_titles (
          cliente_id,nome,slug,asset_bucket,asset_path,asset_version,sha256,formatos,group_id
       ) VALUES (
          'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Cross','cross','ap-images',
          'visual-titles/aaaaaaaa/cross/x.png','v',repeat('d',64),ARRAY['feed']::text[],
          'e0000000-0000-4000-8000-000000000002'
       )$$,
    '23503',
    'cross-client group association was accepted'
);
SELECT pg_temp.assert_raises(
    $$DELETE FROM ap.visual_title_groups
      WHERE id = 'e0000000-0000-4000-8000-000000000001'$$,
    '23503',
    'group with associated titles was deleted'
);
UPDATE ap.visual_title_groups
SET ativo = false
WHERE id = 'e0000000-0000-4000-8000-000000000001';
SELECT pg_temp.assert_true(
    EXISTS (
        SELECT 1 FROM ap.visual_titles
        WHERE id = 'd0000000-0000-4000-8000-000000000003'
          AND group_id = 'e0000000-0000-4000-8000-000000000001'
    ),
    'archiving a group changed its titles'
);

-- New and legacy callers remain compatible while group_id is nullable.
INSERT INTO ap.visual_titles (
    id, cliente_id, nome, slug, asset_bucket, asset_path, asset_version, sha256,
    formatos, group_id
)
VALUES (
    'd0000000-0000-4000-8000-000000000004',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    'Sem grupo',
    'sem-grupo',
    'ap-images',
    'visual-titles/cccccccc-cccc-4ccc-8ccc-cccccccccccc/sem-grupo/d.png',
    'version-d',
    repeat('d', 64),
    ARRAY['reels']::text[],
    NULL
);
INSERT INTO ap.candidate_news (id, cliente_id, titulo, placid_template_uuid)
VALUES (
    'f0000000-0000-4000-8000-000000000001',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'Legacy candidate',
    'legacy-template'
);
SELECT pg_temp.assert_true(
    (SELECT render_contract_version = 'legacy'
       AND visual_title_id IS NULL
       AND placid_template_uuid = 'legacy-template'
     FROM ap.candidate_news
     WHERE id = 'f0000000-0000-4000-8000-000000000001'),
    'legacy candidate_news insert is no longer compatible'
);

-- RLS: a real authenticated session for client A sees and writes only client A.
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
SELECT pg_temp.assert_true(
    (SELECT count(*) = 0 FROM ap.visual_title_groups
     WHERE cliente_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
    'client A can read client B groups'
);
INSERT INTO ap.visual_title_groups (cliente_id, nome, slug)
VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Autorizado', 'autorizado');
SELECT pg_temp.assert_raises(
    $$INSERT INTO ap.visual_title_groups (cliente_id,nome,slug)
      VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Cross tenant','cross-tenant')$$,
    '42501',
    'client A inserted a group for client B'
);
UPDATE ap.visual_title_groups
SET nome = 'Cross update'
WHERE id = 'e0000000-0000-4000-8000-000000000002';
SELECT pg_temp.assert_raises(
    $$DELETE FROM ap.visual_title_groups
      WHERE cliente_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'$$,
    '42501',
    'authenticated user retained DELETE on visual_title_groups'
);
ROLLBACK;
SELECT pg_temp.assert_true(
    (SELECT nome = 'Cidades'
     FROM ap.visual_title_groups
     WHERE id = 'e0000000-0000-4000-8000-000000000002'),
    'client A updated a group for client B'
);

-- Explicit table privileges and effective RLS are both certified.
SELECT pg_temp.assert_true(
    NOT has_table_privilege('authenticated', 'ap.visual_title_groups', 'DELETE')
    AND NOT has_table_privilege('authenticated', 'ap.visual_titles', 'DELETE'),
    'authenticated retains DELETE privilege'
);
SELECT pg_temp.assert_true(
    has_table_privilege('service_role', 'ap.visual_title_groups', 'SELECT')
    AND has_table_privilege('service_role', 'ap.visual_titles', 'SELECT'),
    'service_role lacks catalogue SELECT grants'
);
BEGIN;
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_true(
    (SELECT count(*) > 0 FROM ap.visual_title_groups),
    'service_role cannot read visual_title_groups'
);
ROLLBACK;
BEGIN;
SET LOCAL ROLE anon;
SELECT pg_temp.assert_raises(
    $$INSERT INTO ap.visual_title_groups (cliente_id,nome,slug)
      VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Anon','anon')$$,
    '42501',
    'anon inserted a visual-title group'
);
ROLLBACK;

-- Storage policy exercises the actual path convention. Other legacy paths retain
-- their historical write behavior, while visual-title assets are immutable.
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
INSERT INTO storage.objects (bucket_id, name)
VALUES ('ap-images', 'visual-titles/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/esporte/' || repeat('a', 64) || '.png');
SELECT pg_temp.assert_raises(
    $$INSERT INTO storage.objects (bucket_id,name)
      VALUES ('ap-images','visual-titles/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/urgente/x.png')$$,
    '42501',
    'authenticated user wrote a visual-title asset for another client'
);
UPDATE storage.objects
SET name = 'visual-titles/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/esporte/changed.png'
WHERE bucket_id = 'ap-images'
  AND name = 'visual-titles/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/esporte/' || repeat('a',64) || '.png';
SELECT pg_temp.assert_true(
    EXISTS (
        SELECT 1 FROM storage.objects
        WHERE bucket_id = 'ap-images'
          AND name = 'visual-titles/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/esporte/' || repeat('a',64) || '.png'
    ),
    'visual-title asset update was permitted'
);
DELETE FROM storage.objects
WHERE bucket_id = 'ap-images'
  AND name = 'visual-titles/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/esporte/' || repeat('a',64) || '.png';
SELECT pg_temp.assert_true(
    EXISTS (
        SELECT 1 FROM storage.objects
        WHERE bucket_id = 'ap-images'
          AND name = 'visual-titles/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/esporte/' || repeat('a',64) || '.png'
    ),
    'visual-title asset delete was permitted'
);
INSERT INTO storage.objects (bucket_id, name)
VALUES ('ap-images', 'admin_uploads/legacy-compatible.png');
DELETE FROM storage.objects
WHERE bucket_id = 'ap-images' AND name = 'admin_uploads/legacy-compatible.png';
ROLLBACK;
BEGIN;
SET LOCAL ROLE anon;
SELECT pg_temp.assert_raises(
    $$INSERT INTO storage.objects (bucket_id,name)
      VALUES ('ap-images','visual-titles/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/x/x.png')$$,
    '42501',
    'anon wrote a visual-title asset'
);
ROLLBACK;

-- Simulate a pre-existing slug conflict and rerun the exact migration. It must
-- create a deterministic fallback Geral group without replacing visual-title IDs.
UPDATE ap.visual_titles
SET group_id = NULL
WHERE id = 'd0000000-0000-4000-8000-000000000001';
DELETE FROM ap.visual_title_groups
WHERE cliente_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  AND nome = 'Geral';
INSERT INTO ap.visual_title_groups (cliente_id, nome, slug)
VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Grupo existente', 'geral');
\ir ../../supabase/migrations/20260723213210_visual_title_groups.sql
SELECT pg_temp.assert_true(
    (SELECT group_id IS NOT NULL
     FROM ap.visual_titles
     WHERE id = 'd0000000-0000-4000-8000-000000000001'),
    'idempotent conflict backfill left a legacy title without group'
);
SELECT pg_temp.assert_true(
    EXISTS (
        SELECT 1 FROM ap.visual_title_groups
        WHERE cliente_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
          AND nome = 'Geral'
          AND slug <> 'geral'
    ),
    'slug conflict did not produce a deterministic Geral fallback'
);
SELECT pg_temp.assert_true(
    (SELECT id = 'd0000000-0000-4000-8000-000000000001'
        AND asset_path = 'visual-titles/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/esporte/a.png'
     FROM ap.visual_titles
     WHERE id = 'd0000000-0000-4000-8000-000000000001'),
    'idempotent backfill changed a legacy title identifier or asset'
);

SELECT pg_temp.assert_true(
    (SELECT relrowsecurity FROM pg_class WHERE oid = 'ap.visual_title_groups'::regclass),
    'RLS is not enabled on visual_title_groups'
);
SELECT pg_temp.assert_true(
    (SELECT count(*) = 3 FROM pg_policies
     WHERE schemaname = 'ap' AND tablename = 'visual_title_groups'),
    'visual_title_groups does not have exactly SELECT/INSERT/UPDATE policies'
);

\echo 'visual-title-groups-contract.sql: PASS'
