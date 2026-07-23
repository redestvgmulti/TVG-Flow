\set ON_ERROR_STOP on

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        CREATE ROLE anon NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        CREATE ROLE authenticated NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        CREATE ROLE service_role NOLOGIN BYPASSRLS;
    END IF;
END;
$$;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS ap;

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
    SELECT NULLIF(
        current_setting('request.jwt.claim.sub', true),
        ''
    )::uuid;
$$;

CREATE OR REPLACE FUNCTION auth.jwt()
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
    SELECT COALESCE(
        NULLIF(current_setting('request.jwt.claims', true), '')::jsonb,
        '{}'::jsonb
    );
$$;

CREATE TABLE public.clientes (
    id uuid PRIMARY KEY,
    nome text NOT NULL
);

CREATE TABLE public.cliente_profissionais (
    cliente_id uuid NOT NULL REFERENCES public.clientes(id),
    profissional_id uuid NOT NULL,
    ativo boolean NOT NULL DEFAULT true,
    PRIMARY KEY (cliente_id, profissional_id)
);

CREATE OR REPLACE FUNCTION ap.get_user_cliente_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
    SELECT cp.cliente_id
    FROM public.cliente_profissionais cp
    WHERE cp.profissional_id = auth.uid()
      AND cp.ativo;
$$;

CREATE OR REPLACE FUNCTION ap.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

CREATE TABLE ap.templates (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id uuid NOT NULL,
    placid_template_uuid text NOT NULL,
    nome text NOT NULL,
    ordem integer NOT NULL,
    ativo boolean NOT NULL DEFAULT true,
    uso_total integer NOT NULL DEFAULT 0,
    criado_em timestamptz NOT NULL DEFAULT now(),
    atualizado_em timestamptz NOT NULL DEFAULT now(),
    tipo text NOT NULL DEFAULT 'feed' CHECK (tipo IN ('feed', 'reels')),
    template_set text NOT NULL DEFAULT 'default'
);

CREATE TABLE ap.template_queue_state (
    empresa_id uuid NOT NULL,
    tipo text NOT NULL DEFAULT 'feed',
    template_set text NOT NULL DEFAULT 'default',
    current_index integer NOT NULL DEFAULT 1,
    atualizado_em timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (empresa_id, tipo, template_set)
);

CREATE TABLE ap.candidate_news (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cliente_id uuid NOT NULL REFERENCES public.clientes(id),
    status text NOT NULL DEFAULT 'raw'
        CHECK (status IN (
            'raw',
            'processing',
            'pending_render',
            'pending_review',
            'approved',
            'failed'
        )),
    titulo text NOT NULL,
    conteudo text,
    url_original text,
    imagem_url text,
    content_type text NOT NULL DEFAULT 'feed'
        CHECK (content_type IN ('feed', 'reels')),
    template_set text NOT NULL DEFAULT 'default',
    template_id uuid,
    template_ordem integer,
    placid_template_uuid text,
    template_nome_snapshot text,
    criado_por_user_id uuid,
    role_criador text,
    gerado_em timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ap.patrocinadores (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cliente_id uuid NOT NULL REFERENCES public.clientes(id),
    nome text NOT NULL,
    template_id text,
    logo_url text,
    ativo boolean DEFAULT true,
    ultimo_uso_at timestamptz,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

CREATE TRIGGER trg_ap_patrocinadores_updated_at
BEFORE UPDATE ON ap.patrocinadores
FOR EACH ROW EXECUTE FUNCTION ap.set_updated_at();

CREATE OR REPLACE FUNCTION ap.select_sponsor(p_cliente_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ap
AS $$
DECLARE
    v_id uuid;
BEGIN
    SELECT id
    INTO v_id
    FROM patrocinadores
    WHERE cliente_id = p_cliente_id
      AND ativo
    ORDER BY ultimo_uso_at ASC NULLS FIRST
    LIMIT 1
    FOR UPDATE SKIP LOCKED;

    IF v_id IS NOT NULL THEN
        UPDATE patrocinadores
        SET ultimo_uso_at = now()
        WHERE id = v_id;
    END IF;

    RETURN v_id;
END;
$$;

CREATE TABLE ap.template_render_profiles (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id uuid NOT NULL UNIQUE REFERENCES ap.templates(id),
    profile_version text NOT NULL,
    other_slots jsonb NOT NULL DEFAULT '{}'::jsonb,
    ativo boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION ap.get_and_advance_template(
    p_empresa_id uuid,
    p_tipo text DEFAULT 'feed',
    p_template_set text DEFAULT 'default'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_current_index integer;
    v_total_templates integer;
    v_selected_template record;
    v_effective_set text := p_template_set;
BEGIN
    SELECT count(*)
    INTO v_total_templates
    FROM ap.templates
    WHERE empresa_id = p_empresa_id
      AND ativo
      AND tipo = p_tipo
      AND template_set = v_effective_set;

    IF v_total_templates = 0 AND v_effective_set <> 'default' THEN
        v_effective_set := 'default';
        SELECT count(*)
        INTO v_total_templates
        FROM ap.templates
        WHERE empresa_id = p_empresa_id
          AND ativo
          AND tipo = p_tipo
          AND template_set = v_effective_set;
    END IF;

    IF v_total_templates = 0 THEN
        RAISE EXCEPTION 'No active template';
    END IF;

    INSERT INTO ap.template_queue_state (
        empresa_id,
        tipo,
        template_set,
        current_index
    )
    VALUES (
        p_empresa_id,
        p_tipo,
        v_effective_set,
        1
    )
    ON CONFLICT (empresa_id, tipo, template_set) DO NOTHING;

    SELECT current_index
    INTO v_current_index
    FROM ap.template_queue_state
    WHERE empresa_id = p_empresa_id
      AND tipo = p_tipo
      AND template_set = v_effective_set
    FOR UPDATE;

    IF v_current_index IS NULL OR v_current_index > v_total_templates THEN
        v_current_index := 1;
    END IF;

    SELECT id, placid_template_uuid, ordem, nome
    INTO v_selected_template
    FROM ap.templates
    WHERE empresa_id = p_empresa_id
      AND ativo
      AND tipo = p_tipo
      AND template_set = v_effective_set
    ORDER BY ordem
    OFFSET (v_current_index - 1)
    LIMIT 1;

    IF v_selected_template IS NULL THEN
        RAISE EXCEPTION 'Template lookup failed';
    END IF;

    UPDATE ap.template_queue_state
    SET current_index = CASE
            WHEN v_current_index >= v_total_templates THEN 1
            ELSE v_current_index + 1
        END,
        atualizado_em = now()
    WHERE empresa_id = p_empresa_id
      AND tipo = p_tipo
      AND template_set = v_effective_set;

    UPDATE ap.templates
    SET uso_total = uso_total + 1,
        atualizado_em = now()
    WHERE id = v_selected_template.id;

    RETURN jsonb_build_object(
        'id', v_selected_template.id,
        'placid_template_uuid', v_selected_template.placid_template_uuid,
        'ordem', v_selected_template.ordem,
        'nome', v_selected_template.nome,
        'template_set', v_effective_set
    );
END;
$$;

ALTER TABLE ap.templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE ap.template_queue_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE ap.candidate_news ENABLE ROW LEVEL SECURITY;
ALTER TABLE ap.patrocinadores ENABLE ROW LEVEL SECURITY;
ALTER TABLE ap.template_render_profiles ENABLE ROW LEVEL SECURITY;

GRANT USAGE ON SCHEMA ap TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ap
TO authenticated, service_role;

CREATE POLICY candidate_news_tenant_isolation
ON ap.candidate_news
FOR ALL
TO authenticated
USING (
    cliente_id IN (SELECT ap.get_user_cliente_ids())
)
WITH CHECK (
    cliente_id IN (SELECT ap.get_user_cliente_ids())
);
