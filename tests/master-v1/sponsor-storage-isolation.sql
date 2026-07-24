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

CREATE OR REPLACE FUNCTION pg_temp.assert_raises(
    statement text,
    expected_state text,
    message text
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
    BEGIN
        EXECUTE statement;
    EXCEPTION WHEN OTHERS THEN
        IF SQLSTATE = expected_state THEN
            RETURN;
        END IF;
        RAISE;
    END;
    RAISE EXCEPTION 'assertion failed: %', message;
END;
$$;

-- ap-images has no UPDATE policy, so an authenticated UPDATE is silently
-- filtered to zero rows by RLS rather than rejected with an error. Assert on the
-- effect (nothing changed), which is the guarantee that actually matters.
CREATE OR REPLACE FUNCTION pg_temp.assert_no_effect(
    statement text,
    message text
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    v_rows integer;
BEGIN
    EXECUTE statement;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 0 THEN
        RAISE EXCEPTION 'assertion failed: % (% row(s) affected)', message, v_rows;
    END IF;
END;
$$;

-- Fixtures: tenant A plus an authenticated identity linked to it. The auth
-- provisioning trigger now populates profissionais.nome, so inserting auth.users
-- is enough to create the professional; cliente_profissionais then links it to
-- the tenant with a funcao (NOT NULL). The ap-images bucket is provisioned by
-- migration 20260724200500, so no bucket fixture is needed here.
INSERT INTO public.clientes (id, nome)
VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Client A')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, email)
VALUES ('11111111-1111-4111-8111-111111111111', 'prof-a@storage.test')
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
    'editor',
    true
)
ON CONFLICT (cliente_id, profissional_id, funcao)
DO UPDATE SET ativo = EXCLUDED.ativo;

SET LOCAL ROLE authenticated;
SELECT set_config(
    'request.jwt.claim.sub',
    '11111111-1111-4111-8111-111111111111',
    true
);

-- Tenant A can write sponsor and visual-title assets under its own path.
INSERT INTO storage.objects (bucket_id, name)
VALUES (
    'ap-images',
    'sponsors/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/acme/'
        || repeat('a', 64) || '.png'
);

INSERT INTO storage.objects (bucket_id, name)
VALUES (
    'ap-images',
    'visual-titles/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/esporte/'
        || repeat('b', 64) || '.png'
);

-- Tenant A cannot write into tenant B's path (RLS WITH CHECK -> 42501).
SELECT pg_temp.assert_raises(
    $$INSERT INTO storage.objects (bucket_id, name)
      VALUES (
        'ap-images',
        'sponsors/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/acme/'
          || repeat('c', 64) || '.png'
      )$$,
    '42501',
    'authenticated wrote a sponsor for another tenant'
);

-- Immutability of an existing asset. UPDATE has no policy, so RLS filters it to
-- zero rows (no error); DELETE is refused by storage.protect_delete() with 42501.
SELECT pg_temp.assert_no_effect(
    $$UPDATE storage.objects
      SET name = name || '.changed'
      WHERE name LIKE 'sponsors/aaaaaaaa-%'$$,
    'authenticated updated an immutable sponsor'
);

SELECT pg_temp.assert_raises(
    $$DELETE FROM storage.objects
      WHERE name LIKE 'sponsors/aaaaaaaa-%'$$,
    '42501',
    'authenticated deleted an immutable sponsor'
);

-- Legacy upload families remain writable.
INSERT INTO storage.objects (bucket_id, name)
VALUES ('ap-images', 'admin_uploads/legacy-compatible.png');
INSERT INTO storage.objects (bucket_id, name)
VALUES ('ap-images', 'employee_uploads/legacy-compatible.png');

-- Arbitrary, unscoped ap-images paths are not writable.
SELECT pg_temp.assert_raises(
    $$INSERT INTO storage.objects (bucket_id, name)
      VALUES ('ap-images', 'arbitrary/unscoped.png')$$,
    '42501',
    'authenticated wrote an arbitrary ap-images path'
);

RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.assert_raises(
    $$INSERT INTO storage.objects (bucket_id, name)
      VALUES (
        'ap-images',
        'sponsors/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/acme/'
          || repeat('d', 64) || '.png'
      )$$,
    '42501',
    'anon wrote a sponsor asset'
);

RESET ROLE;
-- service_role keeps operational access. Direct deletes are guarded by
-- storage.protect_delete(); the Storage API authorizes them by setting
-- storage.allow_delete_query, which this block reproduces.
SET LOCAL ROLE service_role;
INSERT INTO storage.objects (bucket_id, name)
VALUES ('ap-images', 'service-managed/runtime.png');
UPDATE storage.objects
SET name = 'service-managed/runtime-v2.png'
WHERE name = 'service-managed/runtime.png';
SET LOCAL storage.allow_delete_query = 'true';
DELETE FROM storage.objects
WHERE name = 'service-managed/runtime-v2.png';
SET LOCAL storage.allow_delete_query = 'false';

RESET ROLE;
SELECT pg_temp.assert_true(
    has_table_privilege('authenticated', 'storage.objects', 'INSERT'),
    'authenticated lost insert privilege'
);
-- storage.objects is owned by supabase_storage_admin, so the migration's
-- REVOKE UPDATE, DELETE FROM authenticated is inert: authenticated keeps the
-- table privilege. Immutability is therefore enforced structurally, not by the
-- revoke, and is certified here directly:
--   * UPDATE: no UPDATE policy exists, so RLS filters authenticated updates to
--     zero rows (proven above via assert_no_effect).
--   * DELETE: the storage.protect_delete() guard rejects any direct SQL delete
--     with 42501 (proven above).
SELECT pg_temp.assert_true(
    NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'storage' AND tablename = 'objects' AND cmd = 'UPDATE'
    ),
    'an UPDATE policy would allow mutation of ap-images assets'
);
SELECT pg_temp.assert_true(
    EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgrelid = 'storage.objects'::regclass
          AND tgname = 'protect_objects_delete'
          AND NOT tgisinternal
    ),
    'the storage delete guard trigger is missing'
);
SELECT pg_temp.assert_true(
    has_table_privilege('service_role', 'storage.objects', 'UPDATE, DELETE'),
    'service_role lost operational privileges'
);

ROLLBACK;

\echo 'sponsor-storage-isolation.sql: PASS'
