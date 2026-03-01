-- 1. Adiciona os novos campos para o Modo Studio na tabela principal
ALTER TABLE ap.candidate_news 
ADD COLUMN IF NOT EXISTS roteiro_studio text,
ADD COLUMN IF NOT EXISTS duracao_estimada integer,
ADD COLUMN IF NOT EXISTS broll_sugestao text,
ADD COLUMN IF NOT EXISTS studio_media_image_url text,
ADD COLUMN IF NOT EXISTS studio_media_video_url text,
ADD COLUMN IF NOT EXISTS enviado_para_studio boolean DEFAULT false;

-- 2. Derruba as views dependentes antigas para evitar crash de 'cannot drop columns' do Postgres
DROP VIEW IF EXISTS public.ap_candidate_news_complete CASCADE;
DROP VIEW IF EXISTS public.ap_candidate_news CASCADE;

-- 3. Recria a view principal com SELECT * para refletir dinamicamente a candidate_news atualizada
CREATE VIEW public.ap_candidate_news AS
SELECT *
FROM ap.candidate_news;

-- 4. Recria a view de Join com candidate_scores
CREATE VIEW public.ap_candidate_news_complete AS
SELECT 
    n.*,
    COALESCE(
        (SELECT json_agg(json_build_object('score_total', s.score_total))
         FROM ap.candidate_scores s
         WHERE s.news_id = n.id), 
         '[]'::json
    ) AS ap_candidate_scores
FROM ap.candidate_news n;

-- 5. Restaura as permissões corretas
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ap_candidate_news TO authenticated, anon, service_role;
GRANT SELECT ON public.ap_candidate_news_complete TO authenticated, anon, service_role;
