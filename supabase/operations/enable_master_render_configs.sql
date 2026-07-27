-- ============================================================================
-- Enable the four fixed masters for ONE client. Operator-run, one client at a
-- time, in its own maintenance window — never in the same window as the rename
-- migration. Migrate first, validate in staging, generate one matéria per
-- (formato × modelo), and only then enable clients gradually.
-- ============================================================================
-- Pure SQL: no psql \set, so this runs unchanged in the Supabase SQL Editor,
-- in psql, and in any migration runner. Replace the UUID in BOTH places.
--
-- It is self-validating and transactional: if it does not update exactly the
-- four expected rows, it raises and nothing is committed. It never creates a
-- master row (the seed does that) and never changes a UUID or a layer map.
--
-- PRECONDITION: 20260727120000 must already be applied, otherwise the TVG + IMG
-- rows are still stored as 'misto' and the UPDATE below matches only two rows —
-- which is exactly what the ROW_COUNT guard will tell you.
-- ============================================================================

BEGIN;

DO $$
DECLARE
  v_cliente_id uuid := 'COLE-AQUI-O-UUID-DO-CLIENTE';
  v_updated integer;
  v_total integer;
BEGIN
  UPDATE ap.master_render_configs
  SET enabled = true
  WHERE cliente_id = v_cliente_id
    AND (content_type, visual_model, master_template_uuid) IN (
      ('feed',  'tvg',     'mzszfje7xdh6l'),
      ('reels', 'tvg',     'xcxtk9tt7syfd'),
      ('feed',  'tvg_img', '3pm4re4blrizh'),
      ('reels', 'tvg_img', 'rrbcykdqcrqae')
    );

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated <> 4 THEN
    RAISE EXCEPTION
      'Esperadas 4 configuracoes atualizadas; foram atualizadas %', v_updated
      USING ERRCODE = 'P0001',
            HINT = 'Rode a migration 20260727120000 e confira o seed do cliente.';
  END IF;

  SELECT count(*)
  INTO v_total
  FROM ap.master_render_configs
  WHERE cliente_id = v_cliente_id
    AND enabled = true
    AND (content_type, visual_model, master_template_uuid) IN (
      ('feed',  'tvg',     'mzszfje7xdh6l'),
      ('reels', 'tvg',     'xcxtk9tt7syfd'),
      ('feed',  'tvg_img', '3pm4re4blrizh'),
      ('reels', 'tvg_img', 'rrbcykdqcrqae')
    );

  IF v_total <> 4 THEN
    RAISE EXCEPTION
      'Validacao final falhou: esperadas 4 configuracoes ativas; encontradas %',
      v_total
      USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO ap.master_render_controls (cliente_id, kill_switch)
  VALUES (v_cliente_id, false)
  ON CONFLICT (cliente_id) DO UPDATE SET kill_switch = false;
END
$$;

-- Confira ANTES do COMMIT: quatro linhas, todas enabled, UUIDs corretos.
SELECT content_type, visual_model, master_template_uuid, enabled
FROM ap.master_render_configs
WHERE cliente_id = 'COLE-AQUI-O-UUID-DO-CLIENTE'
ORDER BY content_type, visual_model;

COMMIT;
