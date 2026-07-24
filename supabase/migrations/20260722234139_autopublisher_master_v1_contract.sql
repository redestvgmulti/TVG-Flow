-- Additive master_v1 support. Legacy queue/RPC/render contract is untouched.
CREATE TABLE IF NOT EXISTS ap.visual_titles (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), cliente_id uuid NOT NULL REFERENCES public.clientes(id) ON DELETE RESTRICT,
 nome text NOT NULL, slug text NOT NULL, asset_bucket text NOT NULL DEFAULT 'ap-images', asset_path text NOT NULL, asset_version text NOT NULL, sha256 text NOT NULL,
 ativo boolean NOT NULL DEFAULT true, ordem integer NOT NULL DEFAULT 0, formatos text[] NOT NULL DEFAULT ARRAY['feed','reels']::text[], created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT visual_titles_slug_per_cliente UNIQUE(cliente_id,slug),
 CONSTRAINT visual_titles_formatos_validos CHECK (formatos <@ ARRAY['feed','reels']::text[] AND cardinality(formatos)>0),
 CONSTRAINT visual_titles_asset_path_nonempty CHECK (length(trim(asset_path))>0), CONSTRAINT visual_titles_asset_version_nonempty CHECK(length(trim(asset_version))>0), CONSTRAINT visual_titles_sha256_nonempty CHECK(length(trim(sha256))>0)
);
CREATE INDEX IF NOT EXISTS idx_visual_titles_cliente_formato_ordem ON ap.visual_titles(cliente_id,ordem,nome) WHERE ativo;
CREATE TABLE IF NOT EXISTS ap.master_render_controls (cliente_id uuid PRIMARY KEY REFERENCES public.clientes(id) ON DELETE RESTRICT, kill_switch boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS ap.master_render_configs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), cliente_id uuid NOT NULL REFERENCES public.clientes(id) ON DELETE RESTRICT, content_type text NOT NULL, template_set text, master_template_uuid text,
 enabled boolean NOT NULL DEFAULT false, layer_map jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT master_render_configs_content_type_check CHECK(content_type IN ('feed','reels')), CONSTRAINT master_render_configs_layer_map_object CHECK(jsonb_typeof(layer_map)='object')
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_master_render_config_scope ON ap.master_render_configs(cliente_id,content_type,COALESCE(template_set,''));
CREATE INDEX IF NOT EXISTS idx_master_render_configs_lookup ON ap.master_render_configs(cliente_id,content_type,template_set) WHERE enabled;
CREATE TABLE IF NOT EXISTS ap.template_render_profiles (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), template_id uuid NOT NULL UNIQUE REFERENCES ap.templates(id) ON DELETE RESTRICT, profile_version text NOT NULL,
 sponsor_top jsonb, sponsor_footer_1 jsonb, sponsor_footer_2 jsonb, sponsor_footer_3 jsonb, other_slots jsonb NOT NULL DEFAULT '{}'::jsonb, ativo boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), CONSTRAINT template_render_profiles_other_slots_object CHECK(jsonb_typeof(other_slots)='object')
);
ALTER TABLE ap.candidate_news ADD COLUMN IF NOT EXISTS visual_title_id uuid REFERENCES ap.visual_titles(id) ON DELETE SET NULL, ADD COLUMN IF NOT EXISTS render_contract_version text NOT NULL DEFAULT 'legacy', ADD COLUMN IF NOT EXISTS render_snapshot jsonb;
ALTER TABLE ap.candidate_news DROP CONSTRAINT IF EXISTS candidate_news_render_contract_version_check;
ALTER TABLE ap.candidate_news ADD CONSTRAINT candidate_news_render_contract_version_check CHECK(render_contract_version IN ('legacy','master_v1'));
CREATE INDEX IF NOT EXISTS idx_candidate_news_visual_title ON ap.candidate_news(visual_title_id) WHERE visual_title_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_candidate_news_render_contract ON ap.candidate_news(cliente_id,content_type,render_contract_version) WHERE render_contract_version='master_v1';
ALTER TABLE ap.visual_titles ENABLE ROW LEVEL SECURITY; ALTER TABLE ap.master_render_controls ENABLE ROW LEVEL SECURITY; ALTER TABLE ap.master_render_configs ENABLE ROW LEVEL SECURITY; ALTER TABLE ap.template_render_profiles ENABLE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE,DELETE ON ap.visual_titles,ap.master_render_controls,ap.master_render_configs,ap.template_render_profiles TO authenticated;
CREATE POLICY visual_titles_tenant_isolation ON ap.visual_titles FOR ALL TO authenticated USING(cliente_id IN(SELECT ap.get_user_cliente_ids())) WITH CHECK(cliente_id IN(SELECT ap.get_user_cliente_ids()));
CREATE POLICY master_render_controls_tenant_isolation ON ap.master_render_controls FOR ALL TO authenticated USING(cliente_id IN(SELECT ap.get_user_cliente_ids())) WITH CHECK(cliente_id IN(SELECT ap.get_user_cliente_ids()));
CREATE POLICY master_render_configs_tenant_isolation ON ap.master_render_configs FOR ALL TO authenticated USING(cliente_id IN(SELECT ap.get_user_cliente_ids())) WITH CHECK(cliente_id IN(SELECT ap.get_user_cliente_ids()));
CREATE POLICY template_render_profiles_tenant_isolation ON ap.template_render_profiles FOR ALL TO authenticated USING(EXISTS(SELECT 1 FROM ap.templates t WHERE t.id=template_render_profiles.template_id AND t.empresa_id IN(SELECT ap.get_user_cliente_ids()))) WITH CHECK(EXISTS(SELECT 1 FROM ap.templates t WHERE t.id=template_render_profiles.template_id AND t.empresa_id IN(SELECT ap.get_user_cliente_ids())));
CREATE TRIGGER trg_ap_visual_titles_updated_at BEFORE UPDATE ON ap.visual_titles FOR EACH ROW EXECUTE FUNCTION ap.set_updated_at();
CREATE TRIGGER trg_ap_master_render_controls_updated_at BEFORE UPDATE ON ap.master_render_controls FOR EACH ROW EXECUTE FUNCTION ap.set_updated_at();
CREATE TRIGGER trg_ap_master_render_configs_updated_at BEFORE UPDATE ON ap.master_render_configs FOR EACH ROW EXECUTE FUNCTION ap.set_updated_at();
CREATE TRIGGER trg_ap_template_render_profiles_updated_at BEFORE UPDATE ON ap.template_render_profiles FOR EACH ROW EXECUTE FUNCTION ap.set_updated_at();