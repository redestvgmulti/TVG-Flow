-- 20260806150000_enable_territorial_composer_tvg_multi.sql
-- Enable territorial composer and templates for TVG Multi
-- Implements safe update-then-insert for templates and strict post-conditions

DO $$
DECLARE
  v_cliente_id UUID := 'cd287e6e-f273-4d0f-a72d-2a8c391e40e9';
  v_empresa_id UUID := '006ba477-5e61-4d9f-ab55-b29590efe37d';
  v_tenant_id UUID := '00000000-0000-0000-0000-000000000001';
  v_cliente_exists BOOLEAN;
  v_empresa_exists BOOLEAN;
  v_row_count INT;
  
  v_feed_uuid text := 'yeepfqrsxhsjz';
  v_reels_uuid text := 'z13fdzn6g9glm';
  v_story_uuid text := 'x3djtbgorrtqc';

  v_feed_map jsonb := '{"headline": "titulo-materia", "news_image": "news-image", "visual_title": "selo-png", "footer_slot_1": "patrocinador-1", "footer_slot_2": "patrocinador-2", "footer_slot_3": "patrocinador-3"}';
  v_reels_map jsonb := '{"headline": "titulo-materia", "visual_title": "selo-png", "footer_slot_1": "patrocinador-1", "footer_slot_2": "patrocinador-2", "footer_slot_3": "patrocinador-3"}';
  v_story_map jsonb := '{"footer_slot_1": "patrocinador-1", "footer_slot_2": "patrocinador-2", "footer_slot_3": "patrocinador-3"}';

  v_post_count INT;
  v_post_composer_enabled BOOLEAN;
  v_post_admin_enabled BOOLEAN;
  v_post_ingestion_enabled BOOLEAN;
BEGIN
  -- Precondition 1: Cliente ativo vinculado à empresa
  SELECT EXISTS (
    SELECT 1 FROM public.clientes c
    WHERE c.id = v_cliente_id AND c.ativo = true AND c.empresa_id = v_empresa_id
  ) INTO v_cliente_exists;

  IF NOT v_cliente_exists THEN
    RAISE EXCEPTION 'Precondition failed: Cliente % não está ativo ou não pertence à empresa %', v_cliente_id, v_empresa_id;
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
  ELSIF v_row_count > 1 THEN
    RAISE EXCEPTION 'Múltiplos templates feed ativos para o cliente %', v_cliente_id;
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
  ELSIF v_row_count > 1 THEN
    RAISE EXCEPTION 'Múltiplos templates reels ativos para o cliente %', v_cliente_id;
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
  ELSIF v_row_count > 1 THEN
    RAISE EXCEPTION 'Múltiplos templates story ativos para o cliente %', v_cliente_id;
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

  -- ==========================================
  -- PÓS-CONDIÇÕES OBRIGATÓRIAS
  -- ==========================================

  -- 1. Exatamente 3 templates ativos para o cliente
  SELECT count(*) INTO v_post_count
  FROM ap.territorial_composer_templates
  WHERE cliente_id = v_cliente_id AND ativo = true;

  IF v_post_count != 3 THEN
    RAISE EXCEPTION 'Pós-condição falhou: Esperado 3 templates ativos, encontrado %', v_post_count;
  END IF;

  -- 2. Exatamente 1 Feed, com layer map validado
  SELECT count(*) INTO v_post_count
  FROM ap.territorial_composer_templates
  WHERE cliente_id = v_cliente_id AND ativo = true AND content_type = 'feed' 
    AND master_template_uuid = v_feed_uuid
    AND ap.is_valid_territorial_layer_map('feed', layer_map);

  IF v_post_count != 1 THEN
    RAISE EXCEPTION 'Pós-condição falhou: Configuração Feed inválida ou duplicada';
  END IF;

  -- 3. Exatamente 1 Reels, com layer map validado
  SELECT count(*) INTO v_post_count
  FROM ap.territorial_composer_templates
  WHERE cliente_id = v_cliente_id AND ativo = true AND content_type = 'reels'
    AND master_template_uuid = v_reels_uuid
    AND ap.is_valid_territorial_layer_map('reels', layer_map);

  IF v_post_count != 1 THEN
    RAISE EXCEPTION 'Pós-condição falhou: Configuração Reels inválida ou duplicada';
  END IF;

  -- 4. Exatamente 1 Story, com layer map validado
  SELECT count(*) INTO v_post_count
  FROM ap.territorial_composer_templates
  WHERE cliente_id = v_cliente_id AND ativo = true AND content_type = 'story'
    AND master_template_uuid = v_story_uuid
    AND ap.is_valid_territorial_layer_map('story', layer_map);

  IF v_post_count != 1 THEN
    RAISE EXCEPTION 'Pós-condição falhou: Configuração Story inválida ou duplicada';
  END IF;

  -- 5. composer feature = true
  SELECT enabled INTO v_post_composer_enabled
  FROM ap.territorial_composer_features
  WHERE cliente_id = v_cliente_id;

  IF v_post_composer_enabled IS NOT TRUE THEN
    RAISE EXCEPTION 'Pós-condição falhou: territorial_composer_features não está enabled=true';
  END IF;

  -- 6. system_config: admin_enabled=true, ingestion=false
  SELECT territorial_admin_enabled, ingestion_enabled 
  INTO v_post_admin_enabled, v_post_ingestion_enabled
  FROM ap.system_config
  WHERE cliente_id = v_cliente_id;

  IF v_post_admin_enabled IS NOT TRUE OR v_post_ingestion_enabled IS NOT FALSE THEN
    RAISE EXCEPTION 'Pós-condição falhou: system_config alterado indevidamente (admin: %, ingestion: %)', v_post_admin_enabled, v_post_ingestion_enabled;
  END IF;

  RAISE NOTICE 'Success: territorial_composer_features enabled and validated for TVG Multi';
END $$;
