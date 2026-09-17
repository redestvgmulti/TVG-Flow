-- Isolated contract fixture. Never execute against a real project.
DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
END $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql AS $$ SELECT COALESCE(NULLIF(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT (auth.jwt()->>'sub')::uuid $$;
GRANT USAGE ON SCHEMA auth TO authenticated,service_role;
CREATE SCHEMA ap;
GRANT USAGE ON SCHEMA ap TO authenticated,service_role;
CREATE TABLE public.clientes(id uuid PRIMARY KEY);
CREATE TABLE ap.candidate_news (
 id uuid PRIMARY KEY, cliente_id uuid REFERENCES public.clientes, status text NOT NULL,
 titulo text,conteudo text,headline text,caption text,url_original text,source text,
 imagem_url text,imagem_storage text,image_external boolean,context_tag text,categoria text,visual_title_id uuid,
 content_type text,template_id uuid,template_ordem integer,template_set text,placid_template_uuid text,template_nome_snapshot text,
 render_contract_version text,render_snapshot jsonb,sponsor_count smallint,patrocinador_id uuid,territorial_reservation_id uuid,
 roteiro_json jsonb,roteiro_studio text,duracao_estimada integer,broll_sugestao text,studio_media_image_url text,studio_media_video_url text,
 visual_energy_level text,has_face boolean,render_url text,instagram_post_id text,horario_agendado timestamptz,
 render_started_at timestamptz,render_completed_at timestamptz,completed_at timestamptz,processing_started_at timestamptz,
 approved_by uuid,approved_by_name text,approved_at timestamptz,published_at timestamptz,worker_id uuid,
 error_log text,render_attempts integer DEFAULT 0,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),
 CONSTRAINT candidate_news_status_check CHECK(status IN ('raw','processing','ready_for_scoring','scored','selected','pending_render','pending_review','approved','queued_for_posting','posted','rejected','failed'))
);
CREATE TABLE ap.territorial_sponsor_reservations(id uuid PRIMARY KEY,status text,committed_at timestamptz,reserved_at timestamptz,released_at timestamptz,release_reason text);
CREATE FUNCTION ap.require_editorial_admin_access(p_cliente_id uuid)
RETURNS TABLE(user_id uuid,role text,display_name text) LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
 IF auth.jwt()->>'app_role' IS DISTINCT FROM 'admin' OR (auth.jwt()->>'cliente_id')::uuid IS DISTINCT FROM p_cliente_id THEN
   RAISE EXCEPTION 'EDITORIAL_ADMIN_REQUIRED'; END IF;
 RETURN QUERY SELECT auth.uid(),'admin'::text,'Test Admin'::text;
END $$;
GRANT SELECT,UPDATE ON ap.candidate_news TO authenticated,service_role;
ALTER TABLE ap.candidate_news ENABLE ROW LEVEL SECURITY;
CREATE POLICY candidate_test_tenant ON ap.candidate_news TO authenticated
 USING (cliente_id=(auth.jwt()->>'cliente_id')::uuid);
INSERT INTO public.clientes VALUES('00000000-0000-4000-8000-000000000001');
INSERT INTO ap.candidate_news(id,cliente_id,status,content_type,headline,caption,render_url,studio_media_image_url)
VALUES('00000000-0000-4000-8000-000000000009','00000000-0000-4000-8000-000000000001','posted','feed','Historical','Historical human text','https://example.com/old.png','https://example.com/studio.png');
