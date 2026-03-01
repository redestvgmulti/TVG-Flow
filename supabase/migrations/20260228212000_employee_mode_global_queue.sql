-- Tabela de Templates
CREATE TABLE IF NOT EXISTS ap.templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id UUID NOT NULL,
    placid_template_uuid TEXT NOT NULL,
    nome TEXT NOT NULL,
    ordem INTEGER NOT NULL,
    ativo BOOLEAN NOT NULL DEFAULT true,
    uso_total INTEGER NOT NULL DEFAULT 0,
    criado_em TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    atualizado_em TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Habilitar RLS em ap.templates (bloqueado para edição externa/frontend, controlado via Admin/RPC se necessário)
ALTER TABLE ap.templates ENABLE ROW LEVEL SECURITY;

-- Índice para ordem e empresa
CREATE INDEX idx_ap_templates_ordem ON ap.templates (empresa_id, ordem);

-- Tabela de Estado da Fila (Global Template Queue)
CREATE TABLE IF NOT EXISTS ap.template_queue_state (
    empresa_id UUID PRIMARY KEY,
    current_index INTEGER NOT NULL DEFAULT 1,
    atualizado_em TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Habilitar RLS em ap.template_queue_state
ALTER TABLE ap.template_queue_state ENABLE ROW LEVEL SECURITY;

-- Modificações em ap.candidate_news
ALTER TABLE ap.candidate_news 
ADD COLUMN se_not_exists_criado_por_user_id UUID,
ADD COLUMN se_not_exists_role_criador TEXT,
ADD COLUMN se_not_exists_template_id UUID,
ADD COLUMN se_not_exists_template_ordem INTEGER,
ADD COLUMN se_not_exists_placid_template_uuid TEXT,
ADD COLUMN se_not_exists_template_nome_snapshot TEXT,
ADD COLUMN se_not_exists_gerado_em TIMESTAMP WITH TIME ZONE;
-- A coluna status já existe (text). Novos status: 'processing', 'ready_to_publish', 'failed' (lógica no App)

-- Modificação correta na tabela candidate_news (lidando com colunas que já possam existir)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='ap' AND table_name='candidate_news' AND column_name='criado_por_user_id') THEN
        ALTER TABLE ap.candidate_news ADD COLUMN criado_por_user_id UUID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='ap' AND table_name='candidate_news' AND column_name='role_criador') THEN
        ALTER TABLE ap.candidate_news ADD COLUMN role_criador TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='ap' AND table_name='candidate_news' AND column_name='template_id') THEN
        ALTER TABLE ap.candidate_news ADD COLUMN template_id UUID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='ap' AND table_name='candidate_news' AND column_name='template_ordem') THEN
        ALTER TABLE ap.candidate_news ADD COLUMN template_ordem INTEGER;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='ap' AND table_name='candidate_news' AND column_name='placid_template_uuid') THEN
        ALTER TABLE ap.candidate_news ADD COLUMN placid_template_uuid TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='ap' AND table_name='candidate_news' AND column_name='template_nome_snapshot') THEN
        ALTER TABLE ap.candidate_news ADD COLUMN template_nome_snapshot TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='ap' AND table_name='candidate_news' AND column_name='gerado_em') THEN
        ALTER TABLE ap.candidate_news ADD COLUMN gerado_em TIMESTAMP WITH TIME ZONE;
    END IF;
END $$;


-- Views: recriando ap_candidate_news e ap_candidate_news_complete para incluir os novos campos
DROP VIEW IF EXISTS public.ap_candidate_news_complete CASCADE;
DROP VIEW IF EXISTS public.ap_candidate_news CASCADE;

CREATE VIEW public.ap_candidate_news AS SELECT * FROM ap.candidate_news;
CREATE VIEW public.ap_candidate_news_complete AS SELECT * FROM ap.candidate_news;

-- RPC: Função Transacional de Fila Global
CREATE OR REPLACE FUNCTION ap.get_and_advance_template(p_empresa_id UUID)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER -- Permite que a Edge Function execute ignorando RLS inicial para buscar a fila
AS $$
DECLARE
    v_current_index INTEGER;
    v_total_templates INTEGER;
    v_selected_template RECORD;
    v_result jsonb;
BEGIN
    -- 1. Garantir que o state existe (se não existir, cria com 1) e LOCK (FOR UPDATE)
    INSERT INTO ap.template_queue_state (empresa_id, current_index)
    VALUES (p_empresa_id, 1)
    ON CONFLICT (empresa_id) DO NOTHING;

    SELECT current_index INTO v_current_index 
    FROM ap.template_queue_state 
    WHERE empresa_id = p_empresa_id 
    FOR UPDATE;

    -- 2. Verifica total de templates ativos
    SELECT count(*) INTO v_total_templates
    FROM ap.templates
    WHERE empresa_id = p_empresa_id AND ativo = true;

    -- 3. Se não houver template ativo -> erro
    IF v_total_templates = 0 THEN
        RAISE EXCEPTION 'Nenhum template ativo encontrado para a empresa_id %', p_empresa_id;
    END IF;

    -- 3.5 Fallback se current_index desincronizar com uma exclusão
    IF v_current_index > v_total_templates THEN
        v_current_index := 1;
    END IF;

    -- 4. Selecionar o template exato baseado na ordem ascendente (usamos OFFSET)
    SELECT id, placid_template_uuid, ordem, nome 
    INTO v_selected_template
    FROM ap.templates
    WHERE empresa_id = p_empresa_id AND ativo = true
    ORDER BY ordem ASC
    OFFSET (v_current_index - 1) LIMIT 1;

    IF v_selected_template IS NULL THEN
         RAISE EXCEPTION 'Falha ao recuperar template no índice %', v_current_index;
    END IF;

    -- 5. Atualizar Queue (Avançar ou Resetar)
    IF v_current_index >= v_total_templates THEN
        UPDATE ap.template_queue_state 
        SET current_index = 1, atualizado_em = NOW()
        WHERE empresa_id = p_empresa_id;
    ELSE
        UPDATE ap.template_queue_state 
        SET current_index = current_index + 1, atualizado_em = NOW()
        WHERE empresa_id = p_empresa_id;
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

-- Permite acesso p/ role anon, service_role e authenticated via RPC
GRANT EXECUTE ON FUNCTION ap.get_and_advance_template(UUID) TO anon, authenticated, service_role;
