-- 1. Updates to ap.templates
ALTER TABLE ap.templates 
ADD COLUMN IF NOT EXISTS template_set TEXT DEFAULT 'default';

UPDATE ap.templates
SET template_set = 'default'
WHERE template_set IS NULL;

-- 2. Updates to ap.candidate_news
ALTER TABLE ap.candidate_news 
ADD COLUMN IF NOT EXISTS template_set TEXT DEFAULT 'default';

UPDATE ap.candidate_news
SET template_set = 'default'
WHERE template_set IS NULL;

-- Drop and recreate views to reflect new columns
DROP VIEW IF EXISTS public.ap_candidate_news_complete CASCADE;
DROP VIEW IF EXISTS public.ap_candidate_news CASCADE;

CREATE VIEW public.ap_candidate_news AS SELECT * FROM ap.candidate_news;
CREATE VIEW public.ap_candidate_news_complete AS SELECT * FROM ap.candidate_news;

-- 3. Safe Migration for ap.template_queue_state
ALTER TABLE ap.template_queue_state 
ADD COLUMN IF NOT EXISTS template_set TEXT DEFAULT 'default';

UPDATE ap.template_queue_state 
SET template_set = 'default' 
WHERE template_set IS NULL;

ALTER TABLE ap.template_queue_state 
ALTER COLUMN template_set SET NOT NULL;

-- Drop the old Primary Key
DO $$
DECLARE
    pk_name text;
BEGIN
    SELECT constraint_name INTO pk_name
    FROM information_schema.table_constraints
    WHERE table_schema = 'ap' 
      AND table_name = 'template_queue_state' 
      AND constraint_type = 'PRIMARY KEY';

    IF pk_name IS NOT NULL THEN
        EXECUTE 'ALTER TABLE ap.template_queue_state DROP CONSTRAINT ' || pk_name;
    END IF;
END $$;

-- Add the new composite Primary Key
ALTER TABLE ap.template_queue_state 
ADD PRIMARY KEY (empresa_id, tipo, template_set);


-- 4. RPC: get_and_advance_template com p_template_set e fallback
CREATE OR REPLACE FUNCTION ap.get_and_advance_template(
    p_empresa_id UUID, 
    p_tipo TEXT DEFAULT 'feed',
    p_template_set TEXT DEFAULT 'default'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_current_index INTEGER;
    v_total_templates INTEGER;
    v_selected_template RECORD;
    v_result jsonb;
    v_effective_set TEXT := p_template_set;
BEGIN
    -- 1. Verifica total de templates ativos do mesmo tipo e set
    SELECT count(*) INTO v_total_templates
    FROM ap.templates
    WHERE empresa_id = p_empresa_id AND ativo = true AND tipo = p_tipo AND template_set = v_effective_set;

    -- Se não houver template ativo no set solicitado, FALLBACK para 'default'
    IF v_total_templates = 0 AND v_effective_set != 'default' THEN
        v_effective_set := 'default';
        SELECT count(*) INTO v_total_templates
        FROM ap.templates
        WHERE empresa_id = p_empresa_id AND ativo = true AND tipo = p_tipo AND template_set = v_effective_set;
    END IF;

    -- Se ainda assim não houver nada, erro
    IF v_total_templates = 0 THEN
        RAISE EXCEPTION 'Nenhum template ativo encontrado para empresa_id %, tipo % e set %', p_empresa_id, p_tipo, v_effective_set;
    END IF;

    -- 2. Garantir que o state existe (se não existir, cria com 1) e LOCK (FOR UPDATE)
    INSERT INTO ap.template_queue_state (empresa_id, tipo, template_set, current_index)
    VALUES (p_empresa_id, p_tipo, v_effective_set, 1)
    ON CONFLICT (empresa_id, tipo, template_set) DO NOTHING;

    -- Travar a fila específica do set selecionado
    SELECT current_index INTO v_current_index 
    FROM ap.template_queue_state 
    WHERE empresa_id = p_empresa_id AND tipo = p_tipo AND template_set = v_effective_set
    FOR UPDATE;

    -- 3.5 Fallback se current_index desincronizar
    IF v_current_index > v_total_templates THEN
        v_current_index := 1;
    END IF;

    -- 4. Selecionar o template exato baseado na ordem ascendente (usamos OFFSET)
    SELECT id, placid_template_uuid, ordem, nome 
    INTO v_selected_template
    FROM ap.templates
    WHERE empresa_id = p_empresa_id AND ativo = true AND tipo = p_tipo AND template_set = v_effective_set
    ORDER BY ordem ASC
    OFFSET (v_current_index - 1) LIMIT 1;

    IF v_selected_template IS NULL THEN
        -- Fallback de emergência caso OFFSET falhe logo após exclusão
        SELECT id, placid_template_uuid, ordem, nome 
        INTO v_selected_template
        FROM ap.templates
        WHERE empresa_id = p_empresa_id AND ativo = true AND tipo = p_tipo AND template_set = v_effective_set
        ORDER BY ordem ASC
        LIMIT 1;
        
        v_current_index := 1;
        
        IF v_selected_template IS NULL THEN
             RAISE EXCEPTION 'Falha ao recuperar template no índice % do set %', v_current_index, v_effective_set;
        END IF;
    END IF;

    -- 5. Atualizar Queue (Avançar ou Resetar)
    IF v_current_index >= v_total_templates THEN
        UPDATE ap.template_queue_state 
        SET current_index = 1, atualizado_em = NOW()
        WHERE empresa_id = p_empresa_id AND tipo = p_tipo AND template_set = v_effective_set;
    ELSE
        UPDATE ap.template_queue_state 
        SET current_index = current_index + 1, atualizado_em = NOW()
        WHERE empresa_id = p_empresa_id AND tipo = p_tipo AND template_set = v_effective_set;
    END IF;

    -- 6. Incrementar uso_total
    UPDATE ap.templates
    SET uso_total = uso_total + 1, atualizado_em = NOW()
    WHERE id = v_selected_template.id;

    -- 7. Retornar estrutura JSONB
    v_result := jsonb_build_object(
        'id', v_selected_template.id,
        'placid_template_uuid', v_selected_template.placid_template_uuid,
        'ordem', v_selected_template.ordem,
        'nome', v_selected_template.nome,
        'template_set', v_effective_set
    );

    RETURN v_result;
END;
$$;
