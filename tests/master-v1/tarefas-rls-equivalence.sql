\set ON_ERROR_STOP on

-- Safety review for commit 3213aaf, which rebuilt the "RLS: admin ou envolvidos
-- podem modificar" policy on public.tarefas after public.is_user_assigned_to_task
-- was removed, inlining it as (assigned_to = auth.uid() OR a tarefas_micro
-- membership) and adding is_super_admin(). This test certifies that each involved
-- category keeps access and, critically, that a fully uninvolved user has none.
-- Involved non-admin users are deliberately left OUT of empresa_profissionais so
-- the broad "Tenant Based Access" policy cannot mask a regression in the
-- involvement branches. Setup runs with triggers bypassed; the RLS checks run
-- under normal enforcement. Everything is rolled back.

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.assert_true(p_condition boolean, p_message text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF NOT COALESCE(p_condition, false) THEN
        RAISE EXCEPTION 'RLS_FAILED: %', p_message;
    END IF;
END;
$$;

-- Returns how many rows of tarefa T the given identity can see / update.
CREATE OR REPLACE FUNCTION pg_temp.visible(p_uid uuid)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE v_count integer;
BEGIN
    PERFORM set_config('request.jwt.claim.sub', p_uid::text, true);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_count FROM public.tarefas
        WHERE id = '7a5e0000-0000-4000-8000-000000000001';
    RESET ROLE;
    RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.can_update(p_uid uuid)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE v_rows integer;
BEGIN
    PERFORM set_config('request.jwt.claim.sub', p_uid::text, true);
    SET LOCAL ROLE authenticated;
    UPDATE public.tarefas SET titulo = titulo
        WHERE id = '7a5e0000-0000-4000-8000-000000000001';
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RESET ROLE;
    RETURN v_rows;
END;
$$;

-- ---- Setup (triggers bypassed so roles/links can be shaped directly) ----
SET session_replication_role = replica;

INSERT INTO public.empresas (id, nome, slug)
VALUES ('e0e0e0e0-0000-4000-8000-000000000001', 'RLS Co', 'rls-co');

INSERT INTO auth.users (id, email) VALUES
    ('a0000000-0000-4000-8000-0000000000ad', 'admin@rls.test'),
    ('a0000000-0000-4000-8000-00000000005f', 'super@rls.test'),
    ('a0000000-0000-4000-8000-0000000000c0', 'creator@rls.test'),
    ('a0000000-0000-4000-8000-0000000000a5', 'assigned@rls.test'),
    ('a0000000-0000-4000-8000-000000000c31', 'micro@rls.test'),
    ('a0000000-0000-4000-8000-0000000000f0', 'outsider@rls.test');

INSERT INTO public.profissionais (id, nome, email, role) VALUES
    ('a0000000-0000-4000-8000-0000000000ad', 'Admin', 'admin@rls.test', 'admin'),
    ('a0000000-0000-4000-8000-00000000005f', 'Super', 'super@rls.test', 'super_admin'),
    ('a0000000-0000-4000-8000-0000000000c0', 'Creator', 'creator@rls.test', 'profissional'),
    ('a0000000-0000-4000-8000-0000000000a5', 'Assigned', 'assigned@rls.test', 'profissional'),
    ('a0000000-0000-4000-8000-000000000c31', 'Micro', 'micro@rls.test', 'profissional'),
    ('a0000000-0000-4000-8000-0000000000f0', 'Outsider', 'outsider@rls.test', 'profissional');

-- Every identity is an active member of the tenant, so the RESTRICTIVE
-- "Tenant Based Access" policy passes for all of them and access is decided
-- purely by the involvement policy under review. The outsider is a tenant member
-- with no task involvement, which is exactly the case that must be denied.
INSERT INTO public.empresa_profissionais (empresa_id, profissional_id, funcao, ativo)
VALUES
    ('e0e0e0e0-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-0000000000ad', 'membro', true),
    ('e0e0e0e0-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-00000000005f', 'membro', true),
    ('e0e0e0e0-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-0000000000c0', 'membro', true),
    ('e0e0e0e0-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-0000000000a5', 'membro', true),
    ('e0e0e0e0-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000c31', 'membro', true),
    ('e0e0e0e0-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-0000000000f0', 'membro', true);

INSERT INTO public.tarefas (id, empresa_id, titulo, deadline, created_by, assigned_to, status)
VALUES (
    '7a5e0000-0000-4000-8000-000000000001',
    'e0e0e0e0-0000-4000-8000-000000000001',
    'OS de teste', now() + interval '1 day',
    'a0000000-0000-4000-8000-0000000000c0',
    'a0000000-0000-4000-8000-0000000000a5',
    'pendente'
);

INSERT INTO public.tarefas_micro (tarefa_id, profissional_id, funcao)
VALUES (
    '7a5e0000-0000-4000-8000-000000000001',
    'a0000000-0000-4000-8000-000000000c31',
    'execucao'
);

SET session_replication_role = origin;

-- ---- Assertions ----
-- Admin: is_admin_safe() grants both read and write.
SELECT pg_temp.assert_true(pg_temp.visible('a0000000-0000-4000-8000-0000000000ad') = 1, 'admin cannot read the task');
SELECT pg_temp.assert_true(pg_temp.can_update('a0000000-0000-4000-8000-0000000000ad') = 1, 'admin cannot update the task');

-- super_admin: the rebuilt ALL policy grants modify access (the SELECT policy
-- intentionally does not list super_admin, so read is not asserted here).
SELECT pg_temp.assert_true(pg_temp.can_update('a0000000-0000-4000-8000-00000000005f') = 1, 'super_admin cannot update the task');

-- Creator: created_by branch.
SELECT pg_temp.assert_true(pg_temp.visible('a0000000-0000-4000-8000-0000000000c0') = 1, 'creator cannot read own task');
SELECT pg_temp.assert_true(pg_temp.can_update('a0000000-0000-4000-8000-0000000000c0') = 1, 'creator cannot update own task');

-- Assignee: assigned_to branch (added by the commit).
SELECT pg_temp.assert_true(pg_temp.visible('a0000000-0000-4000-8000-0000000000a5') = 1, 'assignee cannot read the task');
SELECT pg_temp.assert_true(pg_temp.can_update('a0000000-0000-4000-8000-0000000000a5') = 1, 'assignee cannot update the task');

-- Micro-task participant: the inlined EXISTS(tarefas_micro ...) branch.
SELECT pg_temp.assert_true(pg_temp.visible('a0000000-0000-4000-8000-000000000c31') = 1, 'micro participant cannot read the task');
SELECT pg_temp.assert_true(pg_temp.can_update('a0000000-0000-4000-8000-000000000c31') = 1, 'micro participant cannot update the task');

-- Outsider: no role, not creator/assignee/participant, not in the tenant.
SELECT pg_temp.assert_true(pg_temp.visible('a0000000-0000-4000-8000-0000000000f0') = 0, 'outsider can read the task');
SELECT pg_temp.assert_true(pg_temp.can_update('a0000000-0000-4000-8000-0000000000f0') = 0, 'outsider can update the task');

ROLLBACK;

\echo 'tarefas-rls-equivalence.sql: PASS'
