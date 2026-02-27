-- ==============================================================================
-- Migration: Exposure Views para Módulo de Autopublicação (AutoPublisher)
-- Descrição: Como o schema 'ap' é fechado na API por default, o Frontend
-- consome através destas Views Públicas. 
-- Inclui também RPC para o Supabase Vault para salvar OpenAI Keys com segurança.
-- ==============================================================================

-- 1. View simples para candidate_news
CREATE OR REPLACE VIEW public.ap_candidate_news AS
SELECT 
    id, cliente_id, status, titulo, conteudo, url_original, headline, caption,
    imagem_url, render_url, instagram_post_id, visual_energy_level,
    posicao_feed, horario_agendado, processing_started_at, created_at, updated_at,
    fonte_id, categoria
FROM ap.candidate_news;

-- 2. View formatada com JOIN do Score para o fetchReview
CREATE OR REPLACE VIEW public.ap_candidate_news_complete AS
SELECT 
    n.id, n.cliente_id, n.status, n.titulo, n.headline, n.caption,
    n.imagem_url, n.render_url, n.instagram_post_id, n.visual_energy_level,
    n.posicao_feed, n.horario_agendado, n.created_at, n.fonte_id, n.categoria,
    COALESCE(
        (SELECT json_agg(json_build_object('score_total', s.score_total))
         FROM ap.candidate_scores s
         WHERE s.news_id = n.id), 
         '[]'::json
    ) AS ap_candidate_scores
FROM ap.candidate_news n;

-- 3. View simples para learning history
CREATE OR REPLACE VIEW public.ap_learning_history AS
SELECT * FROM ap.learning_history;

-- Nota: Grants necessários
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ap_candidate_news TO authenticated;
GRANT SELECT ON public.ap_candidate_news_complete TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ap_learning_history TO authenticated;

-- Garantir acesso da view pro role authenticated
GRANT SELECT, INSERT, UPDATE, DELETE ON ap.candidate_news TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ap.learning_history TO authenticated;
GRANT SELECT ON ap.candidate_scores TO authenticated;


-- ==============================================================================
-- ============================ RPCs do Vault Seguras ===========================
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.insert_secret(name TEXT, secret TEXT, description TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
    new_secret_id UUID;
    existing_id   UUID;
BEGIN
    -- Permitir admin ou super_admin
    IF NOT EXISTS (
        SELECT 1 FROM public.usuarios 
        WHERE id = auth.uid() AND funcao IN ('admin', 'super_admin')
    ) THEN
        RAISE EXCEPTION 'Não autorizado. Acesso apenas para admin/super_admin.';
    END IF;

    -- Tentar encontrar secreto existente e deletar ou atualizar
    SELECT id INTO existing_id FROM vault.secrets WHERE vault.secrets.name = $1 LIMIT 1;

    IF existing_id IS NOT NULL THEN
        DELETE FROM vault.secrets WHERE vault.secrets.name = $1;
    END IF;

    -- Inserir novo
    SELECT vault.create_secret($2, $1, $3) INTO new_secret_id;

    RETURN new_secret_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.insert_secret TO authenticated;
GRANT EXECUTE ON FUNCTION public.insert_secret TO service_role;
