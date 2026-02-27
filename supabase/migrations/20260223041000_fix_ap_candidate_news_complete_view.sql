-- Fix View Contract Mismatch para AutoPublisher
-- Permite que o frontend continue explorando as relations PostgREST 
-- usando views espelhos no schema Public.

-- 1) Garantir que completed_at (solicitado pelo front ou fluxos externos) 
-- exista de fato na tabela física.
ALTER TABLE ap.candidate_news ADD COLUMN IF NOT EXISTS completed_at timestamp with time zone;

-- 2) Recriar a View Completa exportando TODAS as colunas. 
-- NÃO geramos JSON nativo aqui, deixamos que o PostgREST infira o JOIN.
DROP VIEW IF EXISTS public.ap_candidate_news_complete CASCADE;
CREATE OR REPLACE VIEW public.ap_candidate_news_complete AS
SELECT * FROM ap.candidate_news;

-- 3) P/ garantir as rotas base utilizadas em outras partes do JSX
DROP VIEW IF EXISTS public.ap_candidate_news CASCADE;
CREATE OR REPLACE VIEW public.ap_candidate_news AS
SELECT * FROM ap.candidate_news;

-- 4) Criar a View do relacionamento 'ap_candidate_scores'
-- O Frontend faz .select('..., ap_candidate_scores(score_total)'),
-- o PostgREST só conseguirá realizar o Join de ap_candidate_news_complete
-- com ap_candidate_scores se essa entidade estiver também espelhada no public.
DROP VIEW IF EXISTS public.ap_candidate_scores CASCADE;
CREATE OR REPLACE VIEW public.ap_candidate_scores AS 
SELECT * FROM ap.candidate_scores;

-- 5) View base do histórico
DROP VIEW IF EXISTS public.ap_learning_history CASCADE;
CREATE OR REPLACE VIEW public.ap_learning_history AS
SELECT * FROM ap.learning_history;

-- 6) Grants necessários para permissão de acesso
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ap_candidate_news TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ap_candidate_news_complete TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ap_candidate_scores TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ap_learning_history TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON ap.candidate_news TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ap.candidate_scores TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ap.learning_history TO authenticated;
