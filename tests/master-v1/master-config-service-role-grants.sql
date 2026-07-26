\set ON_ERROR_STOP on

-- Proves the P0 grant is read-only and does not weaken the existing tenant
-- policies. All fixtures and role changes are rolled back.
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.assert_true(condition boolean, message text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF NOT COALESCE(condition, false) THEN
        RAISE EXCEPTION 'assertion failed: %', message;
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.assert_raises(
    statement text,
    expected_state text,
    message text
)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    BEGIN
        EXECUTE statement;
    EXCEPTION WHEN OTHERS THEN
        IF SQLSTATE = expected_state THEN RETURN; END IF;
        RAISE;
    END;
    RAISE EXCEPTION 'assertion failed: %', message;
END;
$$;

SELECT pg_temp.assert_true(
    has_table_privilege('service_role', 'ap.master_render_controls', 'SELECT')
    AND has_table_privilege('service_role', 'ap.master_render_configs', 'SELECT')
    AND has_table_privilege('service_role', 'ap.template_render_profiles', 'SELECT'),
    'service_role is missing a required SELECT grant'
);

SELECT pg_temp.assert_true(
    NOT has_table_privilege('service_role', 'ap.master_render_controls', 'INSERT')
    AND NOT has_table_privilege('service_role', 'ap.master_render_controls', 'UPDATE')
    AND NOT has_table_privilege('service_role', 'ap.master_render_controls', 'DELETE')
    AND NOT has_table_privilege('service_role', 'ap.master_render_configs', 'INSERT')
    AND NOT has_table_privilege('service_role', 'ap.master_render_configs', 'UPDATE')
    AND NOT has_table_privilege('service_role', 'ap.master_render_configs', 'DELETE')
    AND NOT has_table_privilege('service_role', 'ap.template_render_profiles', 'INSERT')
    AND NOT has_table_privilege('service_role', 'ap.template_render_profiles', 'UPDATE')
    AND NOT has_table_privilege('service_role', 'ap.template_render_profiles', 'DELETE'),
    'service_role gained a write privilege on master configuration'
);

-- Existing authenticated grants and RLS remain in place.
SELECT pg_temp.assert_true(
    has_table_privilege('authenticated', 'ap.master_render_controls', 'SELECT')
    AND has_table_privilege('authenticated', 'ap.master_render_controls', 'INSERT')
    AND has_table_privilege('authenticated', 'ap.master_render_controls', 'UPDATE')
    AND has_table_privilege('authenticated', 'ap.master_render_controls', 'DELETE')
    AND has_table_privilege('authenticated', 'ap.master_render_configs', 'SELECT')
    AND has_table_privilege('authenticated', 'ap.master_render_configs', 'INSERT')
    AND has_table_privilege('authenticated', 'ap.master_render_configs', 'UPDATE')
    AND has_table_privilege('authenticated', 'ap.master_render_configs', 'DELETE')
    AND has_table_privilege('authenticated', 'ap.template_render_profiles', 'SELECT')
    AND has_table_privilege('authenticated', 'ap.template_render_profiles', 'INSERT')
    AND has_table_privilege('authenticated', 'ap.template_render_profiles', 'UPDATE')
    AND has_table_privilege('authenticated', 'ap.template_render_profiles', 'DELETE'),
    'authenticated grants changed'
);

SELECT pg_temp.assert_true(
    NOT has_table_privilege('anon', 'ap.master_render_controls', 'SELECT')
    AND NOT has_table_privilege('anon', 'ap.master_render_configs', 'SELECT')
    AND NOT has_table_privilege('anon', 'ap.template_render_profiles', 'SELECT'),
    'anon gained access to master configuration'
);

SELECT pg_temp.assert_true(
    (SELECT relrowsecurity FROM pg_class WHERE oid = 'ap.master_render_controls'::regclass)
    AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'ap.master_render_configs'::regclass)
    AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'ap.template_render_profiles'::regclass),
    'RLS was disabled on a master configuration table'
);

INSERT INTO public.clientes (id, nome)
VALUES
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Grant Client A'),
    ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Grant Client B')
ON CONFLICT (id) DO NOTHING;

SET session_replication_role = replica;
INSERT INTO auth.users (id, email)
VALUES ('11111111-1111-4111-8111-111111111111', 'grant-a@test.local')
ON CONFLICT (id) DO NOTHING;
SET session_replication_role = origin;

INSERT INTO public.profissionais (id, nome, email, role)
VALUES (
    '11111111-1111-4111-8111-111111111111',
    'Grant User A',
    'grant-a@test.local',
    'profissional'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.cliente_profissionais (
    cliente_id,
    profissional_id,
    funcao,
    ativo
)
VALUES (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '11111111-1111-4111-8111-111111111111',
    'admin',
    true
)
ON CONFLICT (cliente_id, profissional_id, funcao) DO UPDATE
SET ativo = EXCLUDED.ativo;

INSERT INTO ap.master_render_controls (cliente_id, kill_switch)
VALUES
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', false),
    ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', false)
ON CONFLICT (cliente_id) DO NOTHING;

INSERT INTO ap.master_render_configs (
    cliente_id,
    content_type,
    visual_model,
    master_template_uuid,
    enabled,
    layer_map
)
VALUES
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'feed', 'misto', 'grant-a-master', false,
     '{"headline":"titulo-materia","news_image":"news-image","visual_title":"titulo-png","sponsor_1":"patrocinador-1"}'::jsonb),
    ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'feed', 'misto', 'grant-b-master', false,
     '{"headline":"titulo-materia","news_image":"news-image","visual_title":"titulo-png","sponsor_1":"patrocinador-1"}'::jsonb)
ON CONFLICT (cliente_id, content_type, visual_model) DO NOTHING;

INSERT INTO ap.templates (
    id,
    empresa_id,
    placid_template_uuid,
    nome,
    ordem,
    ativo,
    template_set
)
VALUES
    ('aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'grant-template-a', 'Grant A', 1, true, 'default'),
    ('bbbbbbbb-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'grant-template-b', 'Grant B', 1, true, 'default')
ON CONFLICT (id) DO NOTHING;

INSERT INTO ap.template_render_profiles (template_id, profile_version, ativo)
VALUES
    ('aaaaaaaa-0000-4000-8000-000000000001', 'grant-v1', true),
    ('bbbbbbbb-0000-4000-8000-000000000001', 'grant-v1', true)
ON CONFLICT (template_id) DO NOTHING;

-- service_role can read every configuration row, but cannot write one.
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_true(
    (SELECT count(*) = 2 FROM ap.master_render_controls
     WHERE cliente_id IN ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')),
    'service_role could not SELECT master_render_controls'
);
SELECT pg_temp.assert_true(
    (SELECT count(*) = 2 FROM ap.master_render_configs
     WHERE cliente_id IN ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')),
    'service_role could not SELECT master_render_configs'
);
SELECT pg_temp.assert_true(
    (SELECT count(*) = 2 FROM ap.template_render_profiles
     WHERE profile_version = 'grant-v1'),
    'service_role could not SELECT template_render_profiles'
);
SELECT pg_temp.assert_raises(
    $$INSERT INTO ap.master_render_controls (cliente_id, kill_switch)
      VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', false)$$,
    '42501',
    'service_role inserted master_render_controls'
);
SELECT pg_temp.assert_raises(
    $$INSERT INTO ap.master_render_configs
      (cliente_id, content_type, visual_model, master_template_uuid, enabled, layer_map)
      VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'feed', 'tvg', 'forbidden', false, '{}'::jsonb)$$,
    '42501',
    'service_role inserted master_render_configs'
);
SELECT pg_temp.assert_raises(
    $$INSERT INTO ap.template_render_profiles DEFAULT VALUES$$,
    '42501',
    'service_role inserted template_render_profiles'
);

-- anon cannot even reach the objects.
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.assert_raises(
    $$SELECT count(*) FROM ap.master_render_controls$$,
    '42501',
    'anon selected master_render_controls'
);
SELECT pg_temp.assert_raises(
    $$SELECT count(*) FROM ap.master_render_configs$$,
    '42501',
    'anon selected master_render_configs'
);
SELECT pg_temp.assert_raises(
    $$SELECT count(*) FROM ap.template_render_profiles$$,
    '42501',
    'anon selected template_render_profiles'
);

-- authenticated retains current tenant-scoped visibility.
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config(
    'request.jwt.claim.sub',
    '11111111-1111-4111-8111-111111111111',
    true
);
SELECT pg_temp.assert_true(
    (SELECT count(*) = 1 FROM ap.master_render_controls
     WHERE cliente_id IN ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')),
    'authenticated master_render_controls tenant isolation changed'
);
SELECT pg_temp.assert_true(
    (SELECT count(*) = 1 FROM ap.master_render_configs
     WHERE cliente_id IN ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')),
    'authenticated master_render_configs tenant isolation changed'
);
SELECT pg_temp.assert_true(
    NOT EXISTS (
        SELECT 1
        FROM ap.template_render_profiles
        WHERE template_id = 'bbbbbbbb-0000-4000-8000-000000000001'
    ),
    'authenticated template_render_profiles tenant isolation changed'
);

RESET ROLE;
ROLLBACK;

\echo 'master-config-service-role-grants.sql: PASS'
