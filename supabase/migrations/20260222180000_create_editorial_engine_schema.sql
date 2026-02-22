-- ═══════════════════════════════════════════════════════════════
-- Motor Editorial IA — Schema Enterprise Final Plus Ultra
-- ═══════════════════════════════════════════════════════════════

-- ── Extensions ───────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;

-- ── 1. Settings ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ap.editorial_settings (
    id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cliente_id             uuid NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
    vault_secret_id        uuid,           -- Supabase Vault reference (never raw key)
    model_primary          text NOT NULL DEFAULT 'gpt-4o-mini',
    model_fallback         text NOT NULL DEFAULT 'gpt-4o',
    temperature            numeric(3, 2) NOT NULL DEFAULT 0.7,
    top_p                  numeric(3, 2) NOT NULL DEFAULT 1.0,
    max_tokens             int  NOT NULL DEFAULT 400,
    system_prompt_override boolean NOT NULL DEFAULT false,
    override_prompt_text   text,           -- used only when system_prompt_override = true
    is_active              boolean NOT NULL DEFAULT true,
    created_at             timestamptz NOT NULL DEFAULT now(),
    updated_at             timestamptz NOT NULL DEFAULT now(),
    UNIQUE (cliente_id)
);

-- ── 2. Prompt Versions ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ap.editorial_prompt_versions (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cliente_id     uuid NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
    version_number int  NOT NULL,
    prompt_base    text NOT NULL,
    created_by     uuid,
    is_active      boolean NOT NULL DEFAULT false,
    created_at     timestamptz NOT NULL DEFAULT now(),
    UNIQUE (cliente_id, version_number)
);

-- ── 3. Rules ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ap.editorial_rules (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cliente_id uuid NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
    rule_type  text NOT NULL CHECK (rule_type IN ('forbidden', 'mandatory', 'substitution')),
    value      text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- ── 4. Humanization ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ap.editorial_humanization (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cliente_id          uuid NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
    formality_level     int NOT NULL DEFAULT 50 CHECK (formality_level BETWEEN 0 AND 100),
    creativity_level    int NOT NULL DEFAULT 50 CHECK (creativity_level BETWEEN 0 AND 100),
    technical_level     int NOT NULL DEFAULT 30 CHECK (technical_level BETWEEN 0 AND 100),
    anti_ai_variation   boolean NOT NULL DEFAULT true,
    updated_at          timestamptz NOT NULL DEFAULT now(),
    UNIQUE (cliente_id)
);

-- ── 5. RAG Documents (pgvector) with chunking ─────────────────
CREATE TABLE IF NOT EXISTS ap.editorial_rag_documents (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cliente_id         uuid NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
    file_name          text NOT NULL,
    source_document_id uuid,               -- parent chunk group
    chunk_index        int NOT NULL DEFAULT 0,
    content            text NOT NULL,
    embedding          public.vector(1536),
    created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rag_embedding_cosine_idx
    ON ap.editorial_rag_documents
    USING ivfflat (embedding public.vector_cosine_ops)
    WITH (lists = 100);

-- ── 6. Usage Logs (with prompt snapshot) ─────────────────────
CREATE TABLE IF NOT EXISTS ap.editorial_logs (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cliente_id      uuid NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
    input_tokens    int,
    output_tokens   int,
    cost_estimate   numeric(10, 6),
    model           text,
    prompt_snapshot text,           -- full prompt sent to OpenAI
    created_at      timestamptz NOT NULL DEFAULT now()
);

-- ── 7. Financial Limits ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS ap.editorial_limits (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cliente_id           uuid NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
    monthly_token_limit  int NOT NULL DEFAULT 500000,
    monthly_token_used   int NOT NULL DEFAULT 0,
    last_reset_date      date NOT NULL DEFAULT CURRENT_DATE,
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now(),
    UNIQUE (cliente_id)
);

-- ── Updated_at triggers ───────────────────────────────────────
CREATE OR REPLACE FUNCTION ap.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_editorial_settings_updated ON ap.editorial_settings;
CREATE TRIGGER trg_editorial_settings_updated
    BEFORE UPDATE ON ap.editorial_settings
    FOR EACH ROW EXECUTE FUNCTION ap.touch_updated_at();

DROP TRIGGER IF EXISTS trg_editorial_humanization_updated ON ap.editorial_humanization;
CREATE TRIGGER trg_editorial_humanization_updated
    BEFORE UPDATE ON ap.editorial_humanization
    FOR EACH ROW EXECUTE FUNCTION ap.touch_updated_at();

DROP TRIGGER IF EXISTS trg_editorial_limits_updated ON ap.editorial_limits;
CREATE TRIGGER trg_editorial_limits_updated
    BEFORE UPDATE ON ap.editorial_limits
    FOR EACH ROW EXECUTE FUNCTION ap.touch_updated_at();

-- ── RLS ───────────────────────────────────────────────────────
ALTER TABLE ap.editorial_settings         ENABLE ROW LEVEL SECURITY;
ALTER TABLE ap.editorial_prompt_versions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE ap.editorial_rules            ENABLE ROW LEVEL SECURITY;
ALTER TABLE ap.editorial_humanization     ENABLE ROW LEVEL SECURITY;
ALTER TABLE ap.editorial_rag_documents    ENABLE ROW LEVEL SECURITY;
ALTER TABLE ap.editorial_logs             ENABLE ROW LEVEL SECURITY;
ALTER TABLE ap.editorial_limits           ENABLE ROW LEVEL SECURITY;

-- RLS helper (reuse from ap schema)
-- All tables: only accessible by authenticated users whose cliente_id matches
DO $$
DECLARE
    tables text[] := ARRAY[
        'editorial_settings',
        'editorial_prompt_versions',
        'editorial_rules',
        'editorial_humanization',
        'editorial_rag_documents',
        'editorial_logs',
        'editorial_limits'
    ];
    t text;
BEGIN
    FOREACH t IN ARRAY tables LOOP
        EXECUTE format(
            'CREATE POLICY "tenant_isolation_%s"
             ON ap.%I
             FOR ALL TO authenticated
             USING (
                 cliente_id = ANY (public.get_user_cliente_ids())
             )',
            t, t
        );
    END LOOP;
END;
$$;

-- ── RAG Similarity Search Function ───────────────────────────
CREATE OR REPLACE FUNCTION ap.match_editorial_documents(
    query_embedding  public.vector(1536),
    p_cliente_id     uuid,
    match_count      int DEFAULT 5
)
RETURNS TABLE (
    id          uuid,
    content     text,
    file_name   text,
    chunk_index int,
    similarity  float
)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT
        d.id,
        d.content,
        d.file_name,
        d.chunk_index,
        1 - (d.embedding <=> query_embedding) AS similarity
    FROM ap.editorial_rag_documents d
    WHERE d.cliente_id = p_cliente_id
      AND d.embedding IS NOT NULL
    ORDER BY d.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;
