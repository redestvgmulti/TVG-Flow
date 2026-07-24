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

INSERT INTO public.cliente_profissionais (
    cliente_id,
    profissional_id,
    ativo
)
VALUES (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '11111111-1111-4111-8111-111111111111',
    true
)
ON CONFLICT (cliente_id, profissional_id)
DO UPDATE SET ativo = EXCLUDED.ativo;

SET LOCAL ROLE authenticated;
SELECT set_config(
    'request.jwt.claim.sub',
    '11111111-1111-4111-8111-111111111111',
    true
);

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

SELECT pg_temp.assert_raises(
    $$UPDATE storage.objects
      SET name = name || '.changed'
      WHERE name LIKE 'sponsors/aaaaaaaa-%'$$,
    '42501',
    'authenticated updated an immutable sponsor'
);

SELECT pg_temp.assert_raises(
    $$DELETE FROM storage.objects
      WHERE name LIKE 'sponsors/aaaaaaaa-%'$$,
    '42501',
    'authenticated deleted an immutable sponsor'
);

INSERT INTO storage.objects (bucket_id, name)
VALUES ('ap-images', 'admin_uploads/legacy-compatible.png');
INSERT INTO storage.objects (bucket_id, name)
VALUES ('ap-images', 'employee_uploads/legacy-compatible.png');

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
SET LOCAL ROLE service_role;
INSERT INTO storage.objects (bucket_id, name)
VALUES ('ap-images', 'service-managed/runtime.png');
UPDATE storage.objects
SET name = 'service-managed/runtime-v2.png'
WHERE name = 'service-managed/runtime.png';
DELETE FROM storage.objects
WHERE name = 'service-managed/runtime-v2.png';

RESET ROLE;
SELECT pg_temp.assert_true(
    has_table_privilege('authenticated', 'storage.objects', 'INSERT'),
    'authenticated lost insert privilege'
);
SELECT pg_temp.assert_true(
    NOT has_table_privilege('authenticated', 'storage.objects', 'UPDATE'),
    'authenticated still has update privilege'
);
SELECT pg_temp.assert_true(
    NOT has_table_privilege('authenticated', 'storage.objects', 'DELETE'),
    'authenticated still has delete privilege'
);
SELECT pg_temp.assert_true(
    has_table_privilege('service_role', 'storage.objects', 'UPDATE, DELETE'),
    'service_role lost operational privileges'
);

ROLLBACK;

\echo 'sponsor-storage-isolation.sql: PASS'
