-- 1. Updates to ap.templates
ALTER TABLE ap.templates 
ADD COLUMN IF NOT EXISTS tipo TEXT CHECK (tipo IN ('feed', 'reels')) DEFAULT 'feed';

-- 2. Updates to ap.candidate_news
ALTER TABLE ap.candidate_news 
ADD COLUMN IF NOT EXISTS content_type TEXT CHECK (content_type IN ('feed', 'reels')) DEFAULT 'feed';

-- Drop and recreate views to reflect new columns
DROP VIEW IF EXISTS public.ap_candidate_news_complete CASCADE;
DROP VIEW IF EXISTS public.ap_candidate_news CASCADE;

CREATE VIEW public.ap_candidate_news AS SELECT * FROM ap.candidate_news;
CREATE VIEW public.ap_candidate_news_complete AS SELECT * FROM ap.candidate_news;

-- 3. Safe Migration for ap.template_queue_state
-- Add tipo column with default 'feed'
ALTER TABLE ap.template_queue_state 
ADD COLUMN IF NOT EXISTS tipo TEXT DEFAULT 'feed';

-- Update any existing records to ensure they have tipo 'feed'
UPDATE ap.template_queue_state 
SET tipo = 'feed' 
WHERE tipo IS NULL;

-- Make 'tipo' NOT NULL after setting the default
ALTER TABLE ap.template_queue_state 
ALTER COLUMN tipo SET NOT NULL;

-- Drop the old Primary Key
-- Doing this safely by finding the constraint name or standard name
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
ADD PRIMARY KEY (empresa_id, tipo);

-- Insert 'reels' records for every distinct empresa_id that already has a 'feed' queue
INSERT INTO ap.template_queue_state (empresa_id, tipo, current_index, atualizado_em)
SELECT DISTINCT empresa_id, 'reels', 1, NOW() 
FROM ap.template_queue_state 
WHERE tipo = 'feed'
ON CONFLICT (empresa_id, tipo) DO NOTHING;


-- 4. RPC: get_and_advance_template com p_tipo
CREATE OR REPLACE FUNCTION ap.get_and_advance_template(p_empresa_id UUID, p_tipo TEXT DEFAULT 'feed')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_current_index INTEGER;
    v_total_templates INTEGER;
    v_selected_template RECORD;
    v_result jsonb;
BEGIN
    -- 1. Garantir que o state existe (se não existir, cria com 1) e LOCK (FOR UPDATE)
    INSERT INTO ap.template_queue_state (empresa_id, tipo, current_index)
    VALUES (p_empresa_id, p_tipo, 1)
    ON CONFLICT (empresa_id, tipo) DO NOTHING;

    SELECT current_index INTO v_current_index 
    FROM ap.template_queue_state 
    WHERE empresa_id = p_empresa_id AND tipo = p_tipo
    FOR UPDATE;

    -- 2. Verifica total de templates ativos do mesmo tipo
    SELECT count(*) INTO v_total_templates
    FROM ap.templates
    WHERE empresa_id = p_empresa_id AND ativo = true AND tipo = p_tipo;

    -- 3. Se não houver template ativo -> erro
    IF v_total_templates = 0 THEN
        RAISE EXCEPTION 'Nenhum template ativo encontrado para a empresa_id % e tipo %', p_empresa_id, p_tipo;
    END IF;

    -- 3.5 Fallback se current_index desincronizar com uma exclusão
    IF v_current_index > v_total_templates THEN
        v_current_index := 1;
    END IF;

    -- 4. Selecionar o template exato baseado na ordem ascendente (usamos OFFSET)
    SELECT id, placid_template_uuid, ordem, nome 
    INTO v_selected_template
    FROM ap.templates
    WHERE empresa_id = p_empresa_id AND ativo = true AND tipo = p_tipo
    ORDER BY ordem ASC
    OFFSET (v_current_index - 1) LIMIT 1;

    IF v_selected_template IS NULL THEN
         RAISE EXCEPTION 'Falha ao recuperar template no índice %', v_current_index;
    END IF;

    -- 5. Atualizar Queue (Avançar ou Resetar)
    IF v_current_index >= v_total_templates THEN
        UPDATE ap.template_queue_state 
        SET current_index = 1, atualizado_em = NOW()
        WHERE empresa_id = p_empresa_id AND tipo = p_tipo;
    ELSE
        UPDATE ap.template_queue_state 
        SET current_index = current_index + 1, atualizado_em = NOW()
        WHERE empresa_id = p_empresa_id AND tipo = p_tipo;
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
        'nome', v_selected_template.nome
    );

    RETURN v_result;
END;
$$;
