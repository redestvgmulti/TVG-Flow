-- 20260806150000_enable_territorial_composer_tvg_multi.sql
-- Enable territorial composer and templates for TVG Multi

DO $$
DECLARE
  v_cliente_id UUID := 'cd287e6e-f273-4d0f-a72d-2a8c391e40e9';
  v_empresa_id UUID := '006ba477-5e61-4d9f-ab55-b29590efe37d';
  v_tenant_id UUID := '00000000-0000-0000-0000-000000000001';
  v_cliente_exists BOOLEAN;
  v_empresa_exists BOOLEAN;
  v_row_count integer;
  
  v_feed_uuid text := 'yeepfqrsxhsjz';
  v_feed_map jsonb := '{"headline": "titulo-materia", "news_image": "news-image", "visual_title": "selo-png", "footer_slot_1": "patrocinador-1", "footer_slot_2": "patrocinador-2", "footer_slot_3": "patrocinador-3"}'::jsonb;
  
  v_reels_uuid text := 'z13fdzn6g9glm';
  v_reels_map jsonb := '{"headline": "titulo-materia", "visual_title": "selo-png", "footer_slot_1": "patrocinador-1", "footer_slot_2": "patrocinador-2", "footer_slot_3": "patrocinador-3"}'::jsonb;
  
  v_story_uuid text := 'x3djtbgorrtqc';
  v_story_map jsonb := '{"footer_slot_1": "patrocinador-1", "footer_slot_2": "patrocinador-2", "footer_slot_3": "patrocinador-3"}'::jsonb;
BEGIN
  -- Precondition 1: Cliente ativo vinculado à empresa
  SELECT EXISTS (
    SELECT 1 FROM public.clientes c
    WHERE c.id = v_cliente_id AND c.ativo = true AND c.empresa_id = v_empresa_id
  ) INTO v_cliente_exists;

  IF NOT v_cliente_exists THEN
    RAISE NOTICE 'AUTOPUBLISHER_OPERATIONAL_TENANT_ABSENT: Cliente % não encontrado. Migration skipped.', v_cliente_id;
    RETURN;
  END IF;

  -- Precondition 2: Empresa ativa vinculada ao tenant correto
  SELECT EXISTS (
    SELECT 1 FROM public.empresas e
    WHERE e.id = v_empresa_id AND e.ativo = true AND e.tenant_id = v_tenant_id
  ) INTO v_empresa_exists;

  IF NOT v_empresa_exists THEN
    RAISE EXCEPTION 'Precondition failed: Empresa % não está ativa ou não pertence ao tenant %', v_empresa_id, v_tenant_id;
  END IF;

  -- Precondition 3: system_config presente e territorial_admin_enabled = true
  IF NOT EXISTS (
    SELECT 1 FROM ap.system_config 
    WHERE cliente_id = v_cliente_id AND territorial_admin_enabled = true
  ) THEN
    RAISE EXCEPTION 'Precondition failed: territorial_admin_enabled não está true para o cliente %', v_cliente_id;
  END IF;

  -- ==========================================
  -- UPSERT DOS TEMPLATES (UPDATE-THEN-INSERT)
  -- ==========================================
  
  -- Format: FEED
  UPDATE ap.territorial_composer_templates 
  SET master_template_uuid = v_feed_uuid,
      layer_map = v_feed_map,
      ativo = true
  WHERE cliente_id = v_cliente_id AND content_type = 'feed';
  
  GET DIAGNOSTICS v_row_count = ROW_COUNT;
  IF v_row_count = 0 THEN
    INSERT INTO ap.territorial_composer_templates (cliente_id, content_type, master_template_uuid, layer_map, ativo)
    VALUES (v_cliente_id, 'feed', v_feed_uuid, v_feed_map, true);
  END IF;

  -- Format: REELS
  UPDATE ap.territorial_composer_templates 
  SET master_template_uuid = v_reels_uuid,
      layer_map = v_reels_map,
      ativo = true
  WHERE cliente_id = v_cliente_id AND content_type = 'reels';
  
  GET DIAGNOSTICS v_row_count = ROW_COUNT;
  IF v_row_count = 0 THEN
    INSERT INTO ap.territorial_composer_templates (cliente_id, content_type, master_template_uuid, layer_map, ativo)
    VALUES (v_cliente_id, 'reels', v_reels_uuid, v_reels_map, true);
  END IF;

  -- Format: STORY
  UPDATE ap.territorial_composer_templates 
  SET master_template_uuid = v_story_uuid,
      layer_map = v_story_map,
      ativo = true
  WHERE cliente_id = v_cliente_id AND content_type = 'story';
  
  GET DIAGNOSTICS v_row_count = ROW_COUNT;
  IF v_row_count = 0 THEN
    INSERT INTO ap.territorial_composer_templates (cliente_id, content_type, master_template_uuid, layer_map, ativo)
    VALUES (v_cliente_id, 'story', v_story_uuid, v_story_map, true);
  END IF;

  -- Enable territorial_composer_features
  UPDATE ap.territorial_composer_features 
  SET enabled = true
  WHERE cliente_id = v_cliente_id;
  
  GET DIAGNOSTICS v_row_count = ROW_COUNT;
  IF v_row_count = 0 THEN
    INSERT INTO ap.territorial_composer_features (cliente_id, enabled)
    VALUES (v_cliente_id, true);
  END IF;

  RAISE NOTICE 'Success: territorial_composer_features enabled and validated for TVG Multi';
END $$;
