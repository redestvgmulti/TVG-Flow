\set ON_ERROR_STOP on

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.assert_eq(
    p_actual text,
    p_expected text,
    p_message text
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
    IF p_actual IS DISTINCT FROM p_expected THEN
        RAISE EXCEPTION 'assertion failed: % (got %, expected %)',
            p_message, COALESCE(quote_literal(p_actual), 'NULL'),
            COALESCE(quote_literal(p_expected), 'NULL');
    END IF;
END;
$$;

-- Each insert fires the real ensure_profissional_on_auth_user trigger; if nome
-- were ever NULL the insert would abort here on profissionais.nome NOT NULL.

-- 1. Signup carrying full_name metadata.
INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES (
    'aa000000-0000-4000-8000-000000000001',
    'maria@example.com',
    '{"full_name": "Maria Completa", "name": "Maria M"}'::jsonb
);
SELECT pg_temp.assert_eq(
    (SELECT nome FROM public.profissionais WHERE id = 'aa000000-0000-4000-8000-000000000001'),
    'Maria Completa',
    'full_name should win the fallback chain'
);

-- 2. Signup carrying only name metadata.
INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES (
    'aa000000-0000-4000-8000-000000000002',
    'joao@example.com',
    '{"name": "Joao Nome"}'::jsonb
);
SELECT pg_temp.assert_eq(
    (SELECT nome FROM public.profissionais WHERE id = 'aa000000-0000-4000-8000-000000000002'),
    'Joao Nome',
    'name should be used when full_name is absent'
);

-- 3. Signup with an email but no usable metadata.
INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES (
    'aa000000-0000-4000-8000-000000000003',
    'ana.paula@example.com',
    '{"full_name": "", "name": ""}'::jsonb
);
SELECT pg_temp.assert_eq(
    (SELECT nome FROM public.profissionais WHERE id = 'aa000000-0000-4000-8000-000000000003'),
    'ana.paula',
    'email local-part should be used when metadata is empty'
);

-- 4. Signup with no metadata at all.
INSERT INTO auth.users (id, email)
VALUES (
    'aa000000-0000-4000-8000-000000000004',
    'bruno@example.com'
);
SELECT pg_temp.assert_eq(
    (SELECT nome FROM public.profissionais WHERE id = 'aa000000-0000-4000-8000-000000000004'),
    'bruno',
    'email local-part should be used when metadata is absent'
);

-- 5. Degenerate email with an empty local part exercises the explicit fallback.
INSERT INTO auth.users (id, email)
VALUES (
    'aa000000-0000-4000-8000-000000000005',
    '@nolocal.example.com'
);
SELECT pg_temp.assert_eq(
    (SELECT nome FROM public.profissionais WHERE id = 'aa000000-0000-4000-8000-000000000005'),
    'Usuário',
    'explicit Usuário fallback should apply when nothing else resolves'
);

-- No row may ever carry a NULL nome.
SELECT pg_temp.assert_eq(
    (SELECT count(*)::text FROM public.profissionais
     WHERE id IN (
        'aa000000-0000-4000-8000-000000000001',
        'aa000000-0000-4000-8000-000000000002',
        'aa000000-0000-4000-8000-000000000003',
        'aa000000-0000-4000-8000-000000000004',
        'aa000000-0000-4000-8000-000000000005'
     )
       AND nome IS NOT NULL),
    '5',
    'every provisioned profissional has a non-null nome'
);

ROLLBACK;

\echo 'profissional-name-fallback.sql: PASS'
