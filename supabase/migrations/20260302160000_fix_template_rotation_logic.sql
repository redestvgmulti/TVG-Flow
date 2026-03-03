-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- FIX: Template Rotation Logic (Reset Index if Out of Bounds)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

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

    -- SELECT ... FOR UPDATE garante que chamadas concorrentes esperem
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

    -- 3.5 CORREÇÃO CRÍTICA: Se o index salvo no banco for maior que o total (ex: após deleções)
    -- Resetamos para 1 para evitar ficar "travado" em um OFFSET inválido ou circular
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

    -- Caso raro de v_selected_template ser nulo após o OFFSET (ex: deleção entre os selects)
    IF v_selected_template IS NULL THEN
        -- Fallback de emergência para o primeiro template disponível
        SELECT id, placid_template_uuid, ordem, nome 
        INTO v_selected_template
        FROM ap.templates
        WHERE empresa_id = p_empresa_id AND ativo = true AND tipo = p_tipo
        ORDER BY ordem ASC
        LIMIT 1;
        
        v_current_index := 1;
    END IF;

    -- 5. Atualizar Queue (Avançar ou Resetar)
    -- CORREÇÃO: Usamos v_current_index (validado) para calcular o próximo estado no banco
    IF v_current_index >= v_total_templates THEN
        UPDATE ap.template_queue_state 
        SET current_index = 1, atualizado_em = NOW()
        WHERE empresa_id = p_empresa_id AND tipo = p_tipo;
    ELSE
        -- Aqui garantimos que o banco receba o valor real seguinte, corrigindo desincronizações
        UPDATE ap.template_queue_state 
        SET current_index = v_current_index + 1, atualizado_em = NOW()
        WHERE empresa_id = p_empresa_id AND tipo = p_tipo;
    END IF;

    -- 6. Incrementar uso_total para estatísticas
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
