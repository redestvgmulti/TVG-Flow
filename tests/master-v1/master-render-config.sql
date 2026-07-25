\set ON_ERROR_STOP on

-- Per-vehicle master configuration for master_v1: each fixed Placid template is
-- one ap.master_render_configs row keyed by (cliente_id, content_type,
-- template_set=vehicle). Proves that (a) several vehicles coexist for the same
-- format, (b) the same vehicle collides, (c) selection resolves the exact
-- template per vehicle, and (d) tenant isolation holds. Rolled back at the end.

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.assert_true(condition boolean, message text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF NOT COALESCE(condition, false) THEN
        RAISE EXCEPTION 'assertion failed: %', message;
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.assert_raises(statement text, expected_state text, message text)
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

-- Fixtures: two tenants and the authenticated identity linked to tenant A. The
-- provisioning trigger fills profissionais.nome; auth.users is seeded with the
-- trigger bypassed only for that insert.
INSERT INTO public.clientes (id, nome)
VALUES
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Client A'),
    ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Client B')
ON CONFLICT (id) DO NOTHING;

SET session_replication_role = replica;
INSERT INTO auth.users (id, email)
VALUES
    ('11111111-1111-4111-8111-111111111111', 'admin-a@mrc.test'),
    ('22222222-2222-4222-8222-222222222222', 'admin-b@mrc.test')
ON CONFLICT (id) DO NOTHING;
SET session_replication_role = origin;

-- role is irrelevant to master_render_configs RLS (it uses ap.get_user_cliente_ids
-- via cliente_profissionais); 'profissional' avoids the admin-promotion trigger.
INSERT INTO public.profissionais (id, nome, email, role)
VALUES
    ('11111111-1111-4111-8111-111111111111', 'Admin A', 'admin-a@mrc.test', 'profissional'),
    ('22222222-2222-4222-8222-222222222222', 'Admin B', 'admin-b@mrc.test', 'profissional')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.cliente_profissionais (cliente_id, profissional_id, funcao, ativo)
VALUES
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 'admin', true),
    ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '22222222-2222-4222-8222-222222222222', 'admin', true)
ON CONFLICT (cliente_id, profissional_id, funcao) DO NOTHING;

-- Authenticated admin for tenant A.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

-- Two vehicles for the SAME format (feed) must coexist: this is the reverted
-- per-format invariant. Each is a distinct fixed Placid template.
INSERT INTO ap.master_render_configs (cliente_id, content_type, template_set, master_template_uuid, enabled, layer_map)
VALUES
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'feed', 'tvg_itumbiara', 'tpl-feed-tvg-itu', true,
     '{"headline":"titulo-materia","news_image":"news-image","visual_title":"titulo-png","sponsor_1":"patrocinador-1"}'::jsonb),
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'feed', 'tvg', 'tpl-feed-tvg', true,
     '{"headline":"titulo-materia","news_image":"news-image","visual_title":"titulo-png","sponsor_1":"patrocinador-1","sponsor_2":"patrocinador-2"}'::jsonb),
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'reels', 'tvg', 'tpl-reels-tvg', true,
     '{"headline":"titulo-materia","visual_title":"titulo-png","sponsor_1":"patrocinador-1","sponsor_2":"patrocinador-2"}'::jsonb);

SELECT pg_temp.assert_true(
    (SELECT count(*) = 2 FROM ap.master_render_configs
     WHERE cliente_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' AND content_type = 'feed'),
    'two feed vehicles did not coexist for one tenant'
);

-- The same vehicle for the same format collides (one master per vehicle).
SELECT pg_temp.assert_raises(
    $$INSERT INTO ap.master_render_configs (cliente_id, content_type, template_set, master_template_uuid, enabled, layer_map)
      VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','feed','tvg','tpl-dup',false,'{}'::jsonb)$$,
    '23505',
    'a duplicate (feed, tvg) vehicle was accepted'
);

-- Deterministic selection: (content_type, template_set=vehicle) resolves the
-- exact fixed template, and the selo layer maps to titulo-png.
SELECT pg_temp.assert_true(
    (SELECT master_template_uuid = 'tpl-feed-tvg-itu'
        AND layer_map ->> 'headline' = 'titulo-materia'
        AND layer_map ->> 'visual_title' = 'titulo-png'
     FROM ap.master_render_configs
     WHERE cliente_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
       AND content_type = 'feed' AND template_set = 'tvg_itumbiara' AND enabled),
    'feed/tvg_itumbiara did not resolve its fixed template + titulo-png layer'
);

SELECT pg_temp.assert_true(
    (SELECT master_template_uuid = 'tpl-reels-tvg'
     FROM ap.master_render_configs
     WHERE cliente_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
       AND content_type = 'reels' AND template_set = 'tvg' AND enabled),
    'reels/tvg did not resolve its own fixed template'
);

-- Editing one vehicle does not touch another vehicle of the same format.
UPDATE ap.master_render_configs
SET master_template_uuid = 'tpl-feed-tvg-itu-edited'
WHERE cliente_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  AND content_type = 'feed' AND template_set = 'tvg_itumbiara';

SELECT pg_temp.assert_true(
    (SELECT master_template_uuid = 'tpl-feed-tvg'
     FROM ap.master_render_configs
     WHERE cliente_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
       AND content_type = 'feed' AND template_set = 'tvg'),
    'editing one vehicle leaked into another vehicle'
);

-- Kill switch upsert for tenant A.
INSERT INTO ap.master_render_controls (cliente_id, kill_switch)
VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true)
ON CONFLICT (cliente_id) DO UPDATE SET kill_switch = EXCLUDED.kill_switch;
SELECT pg_temp.assert_true(
    (SELECT kill_switch FROM ap.master_render_controls WHERE cliente_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
    'kill switch was not persisted for tenant A'
);

-- Tenant isolation: admin A cannot write a config for tenant B (RLS WITH CHECK).
SELECT pg_temp.assert_raises(
    $$INSERT INTO ap.master_render_configs (cliente_id, content_type, template_set, master_template_uuid, enabled, layer_map)
      VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','feed','tvg','tpl-b',false,'{}'::jsonb)$$,
    '42501',
    'admin A wrote a config for tenant B'
);

-- Seed a config for tenant B as postgres (bypasses RLS) to prove read isolation.
RESET ROLE;
INSERT INTO ap.master_render_configs (cliente_id, content_type, template_set, master_template_uuid, enabled, layer_map)
VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','feed','tvg','tpl-b',true,'{}'::jsonb)
ON CONFLICT (cliente_id, content_type, COALESCE(template_set, '')) DO NOTHING;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
SELECT pg_temp.assert_true(
    (SELECT count(*) = 0 FROM ap.master_render_configs
     WHERE cliente_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
    'admin A can read tenant B config'
);

RESET ROLE;
ROLLBACK;

\echo 'master-render-config.sql: PASS'
