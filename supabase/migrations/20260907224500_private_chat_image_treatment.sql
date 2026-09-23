-- Private, immutable image assets for native-chat image treatment.
-- No policy grants browser access to storage.objects; signed URLs are created
-- only by authenticated Edge Functions after tenant and owner checks.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'chat-private-images',
    'chat-private-images',
    false,
    10485760,
    ARRAY['image/png', 'image/jpeg', 'image/webp']::text[]
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

ALTER TABLE ap.ai_runs DROP CONSTRAINT ai_runs_operation_check;
ALTER TABLE ap.ai_runs ADD CONSTRAINT ai_runs_operation_check CHECK (
    operation IN (
        'chat', 'generate_from_link', 'rewrite', 'improve_title',
        'correct', 'summarize', 'variations', 'image_edit'
    )
);

ALTER TABLE ap.ai_runs
    ADD COLUMN input_text_tokens bigint,
    ADD COLUMN input_image_tokens bigint,
    ADD COLUMN output_image_tokens bigint;

ALTER TABLE ap.ai_runs ADD CONSTRAINT ai_runs_image_usage_check CHECK (
    (input_text_tokens IS NULL OR input_text_tokens >= 0)
    AND (input_image_tokens IS NULL OR input_image_tokens >= 0)
    AND (output_image_tokens IS NULL OR output_image_tokens >= 0)
);

CREATE TABLE ap.ai_image_assets (
    id uuid PRIMARY KEY,
    cliente_id uuid NOT NULL REFERENCES public.clientes(id) ON DELETE RESTRICT,
    user_id uuid NOT NULL REFERENCES public.profissionais(id) ON DELETE RESTRICT,
    conversation_id uuid NOT NULL,
    ai_run_id uuid NOT NULL,
    kind text NOT NULL,
    source_image_id uuid REFERENCES ap.ai_image_assets(id) ON DELETE RESTRICT,
    bucket_name text NOT NULL DEFAULT 'chat-private-images',
    storage_path text NOT NULL,
    mime_type text NOT NULL,
    file_extension text NOT NULL,
    byte_size bigint NOT NULL,
    width integer NOT NULL,
    height integer NOT NULL,
    content_sha256 text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ai_image_assets_run_fk
        FOREIGN KEY (ai_run_id, conversation_id, cliente_id, user_id)
        REFERENCES ap.ai_runs(id, conversation_id, cliente_id, user_id)
        ON DELETE RESTRICT,
    CONSTRAINT ai_image_assets_kind_check CHECK (kind IN ('original', 'result')),
    CONSTRAINT ai_image_assets_source_check CHECK (
        (kind = 'original' AND source_image_id IS NULL)
        OR (kind = 'result' AND source_image_id IS NOT NULL)
    ),
    CONSTRAINT ai_image_assets_bucket_check CHECK (bucket_name = 'chat-private-images'),
    CONSTRAINT ai_image_assets_path_check CHECK (
        length(storage_path) BETWEEN 20 AND 500
        AND storage_path !~ '(^|/)\.\.(/|$)'
    ),
    CONSTRAINT ai_image_assets_mime_check CHECK (mime_type IN ('image/png', 'image/jpeg', 'image/webp')),
    CONSTRAINT ai_image_assets_extension_check CHECK (file_extension IN ('png', 'jpg', 'webp')),
    CONSTRAINT ai_image_assets_size_check CHECK (byte_size BETWEEN 24 AND 15728640),
    CONSTRAINT ai_image_assets_dimensions_check CHECK (
        width BETWEEN 64 AND 8192 AND height BETWEEN 64 AND 8192
        AND width::bigint * height::bigint <= 25000000
    ),
    CONSTRAINT ai_image_assets_hash_check CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT ai_image_assets_run_kind_key UNIQUE (ai_run_id, kind),
    CONSTRAINT ai_image_assets_storage_path_key UNIQUE (bucket_name, storage_path)
);

CREATE INDEX ai_image_assets_owner_created_idx
    ON ap.ai_image_assets (cliente_id, user_id, created_at DESC);

CREATE OR REPLACE FUNCTION ap.claim_ai_image_run(
    p_request_id uuid,
    p_cliente_id uuid,
    p_user_id uuid,
    p_conversation_id uuid,
    p_title text,
    p_content text,
    p_requested_model text,
    p_prompt_version_id uuid,
    p_prompt_hash text,
    p_pricing_version text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_conversation_id uuid := COALESCE(p_conversation_id, p_request_id);
    v_run ap.ai_runs%ROWTYPE;
    v_conversation ap.ai_conversations%ROWTYPE;
    v_claimed boolean := false;
BEGIN
    IF p_request_id IS NULL OR p_cliente_id IS NULL OR p_user_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'CHAT_IDENTITY_REQUIRED';
    END IF;
    IF length(btrim(COALESCE(p_content, ''))) NOT BETWEEN 1 AND 50000 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'CHAT_CONTENT_INVALID';
    END IF;

    SELECT * INTO v_run FROM ap.ai_runs
     WHERE user_id = p_user_id AND request_id = p_request_id
     FOR UPDATE;

    IF FOUND THEN
        IF v_run.cliente_id <> p_cliente_id
           OR v_run.conversation_id <> v_conversation_id
           OR v_run.operation <> 'image_edit'
           OR v_run.provider <> 'openai' THEN
            RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'CHAT_REQUEST_SCOPE_MISMATCH';
        END IF;
        IF v_run.prompt_version_id <> p_prompt_version_id
           OR v_run.prompt_hash <> p_prompt_hash
           OR v_run.requested_model <> p_requested_model
           OR v_run.pricing_version <> p_pricing_version THEN
            RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'IMAGE_RETRY_CONTEXT_CHANGED';
        END IF;
        IF v_run.status = 'failed' THEN
            IF v_run.attempt_count >= 10 THEN
                RAISE EXCEPTION USING ERRCODE = '54000', MESSAGE = 'CHAT_RETRY_LIMIT';
            END IF;
            UPDATE ap.ai_runs
               SET status = 'running', completed_at = NULL, error_code = NULL,
                   provider_request_id = NULL, latency_ms = NULL,
                   attempt_count = attempt_count + 1
             WHERE id = v_run.id RETURNING * INTO v_run;
            v_claimed := true;
        END IF;
    ELSE
        INSERT INTO ap.ai_conversations (id, cliente_id, user_id, title)
        VALUES (
            v_conversation_id, p_cliente_id, p_user_id,
            left(COALESCE(NULLIF(btrim(p_title), ''), 'Tratamento de imagem'), 160)
        )
        ON CONFLICT (id) DO NOTHING;

        SELECT * INTO v_conversation FROM ap.ai_conversations
         WHERE id = v_conversation_id FOR UPDATE;
        IF NOT FOUND OR v_conversation.cliente_id <> p_cliente_id
           OR v_conversation.user_id <> p_user_id OR v_conversation.archived_at IS NOT NULL THEN
            RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'CHAT_CONVERSATION_FORBIDDEN';
        END IF;

        IF v_conversation.title = 'Nova conversa'
           AND length(btrim(COALESCE(p_title, ''))) BETWEEN 1 AND 160
           AND NOT EXISTS (SELECT 1 FROM ap.ai_messages WHERE conversation_id = v_conversation.id) THEN
            UPDATE ap.ai_conversations SET title = left(btrim(p_title), 160), updated_at = now()
             WHERE id = v_conversation.id AND cliente_id = p_cliente_id AND user_id = p_user_id;
        END IF;

        INSERT INTO ap.ai_runs (
            request_id, cliente_id, user_id, conversation_id, operation, provider,
            requested_model, prompt_version_id, prompt_hash, pricing_version, status
        ) VALUES (
            p_request_id, p_cliente_id, p_user_id, v_conversation_id, 'image_edit', 'openai',
            p_requested_model, p_prompt_version_id, p_prompt_hash, p_pricing_version, 'running'
        ) RETURNING * INTO v_run;
        v_claimed := true;
    END IF;

    INSERT INTO ap.ai_messages (conversation_id, cliente_id, user_id, role, content, status, ai_run_id)
    VALUES (v_run.conversation_id, v_run.cliente_id, v_run.user_id, 'user', p_content, 'completed', v_run.id)
    ON CONFLICT (ai_run_id, role) WHERE ai_run_id IS NOT NULL DO NOTHING;

    RETURN jsonb_build_object(
        'run_id', v_run.id, 'conversation_id', v_run.conversation_id,
        'status', v_run.status, 'claimed', v_claimed
    );
END;
$$;

CREATE OR REPLACE FUNCTION ap.register_ai_image_original(
    p_run_id uuid,
    p_asset_id uuid,
    p_cliente_id uuid,
    p_user_id uuid,
    p_storage_path text,
    p_mime_type text,
    p_file_extension text,
    p_byte_size bigint,
    p_width integer,
    p_height integer,
    p_content_sha256 text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_run ap.ai_runs%ROWTYPE;
    v_asset ap.ai_image_assets%ROWTYPE;
    v_prefix text;
BEGIN
    SELECT * INTO v_run FROM ap.ai_runs WHERE id = p_run_id FOR UPDATE;
    IF NOT FOUND OR v_run.cliente_id <> p_cliente_id OR v_run.user_id <> p_user_id
       OR v_run.operation <> 'image_edit' OR v_run.status <> 'running' THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'IMAGE_RUN_FORBIDDEN';
    END IF;
    v_prefix := p_cliente_id::text || '/' || p_user_id::text || '/' ||
        v_run.conversation_id::text || '/' || p_run_id::text || '/';
    IF p_storage_path !~ ('^' || v_prefix || 'original\.(png|jpg|webp)$') THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'IMAGE_STORAGE_PATH_INVALID';
    END IF;

    SELECT * INTO v_asset FROM ap.ai_image_assets
     WHERE ai_run_id = p_run_id AND kind = 'original' FOR UPDATE;
    IF FOUND THEN
        IF v_asset.content_sha256 <> p_content_sha256 OR v_asset.storage_path <> p_storage_path THEN
            RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'IMAGE_RETRY_CONTEXT_CHANGED';
        END IF;
        RETURN to_jsonb(v_asset);
    END IF;

    INSERT INTO ap.ai_image_assets (
        id, cliente_id, user_id, conversation_id, ai_run_id, kind,
        storage_path, mime_type, file_extension, byte_size, width, height, content_sha256
    ) VALUES (
        p_asset_id, p_cliente_id, p_user_id, v_run.conversation_id, p_run_id, 'original',
        p_storage_path, p_mime_type, p_file_extension, p_byte_size, p_width, p_height, p_content_sha256
    ) RETURNING * INTO v_asset;
    RETURN to_jsonb(v_asset);
END;
$$;

CREATE OR REPLACE FUNCTION ap.complete_ai_image_run(
    p_run_id uuid,
    p_asset_id uuid,
    p_storage_path text,
    p_mime_type text,
    p_file_extension text,
    p_byte_size bigint,
    p_width integer,
    p_height integer,
    p_content_sha256 text,
    p_content text,
    p_actual_model text,
    p_provider_request_id text,
    p_input_tokens bigint,
    p_input_text_tokens bigint,
    p_input_image_tokens bigint,
    p_output_tokens bigint,
    p_output_image_tokens bigint,
    p_cost_estimate numeric,
    p_latency_ms bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_run ap.ai_runs%ROWTYPE;
    v_original ap.ai_image_assets%ROWTYPE;
    v_result ap.ai_image_assets%ROWTYPE;
    v_message ap.ai_messages%ROWTYPE;
    v_prefix text;
BEGIN
    SELECT * INTO v_run FROM ap.ai_runs WHERE id = p_run_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'CHAT_RUN_NOT_FOUND'; END IF;

    IF v_run.status = 'completed' THEN
        SELECT * INTO v_result FROM ap.ai_image_assets WHERE ai_run_id = p_run_id AND kind = 'result';
        SELECT * INTO v_message FROM ap.ai_messages WHERE ai_run_id = p_run_id AND role = 'assistant';
        RETURN jsonb_build_object('run_id', p_run_id, 'message_id', v_message.id, 'asset_id', v_result.id);
    END IF;
    IF v_run.status <> 'running' OR v_run.operation <> 'image_edit' THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'IMAGE_RUN_NOT_RUNNING';
    END IF;

    SELECT * INTO v_original FROM ap.ai_image_assets
     WHERE ai_run_id = p_run_id AND kind = 'original';
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'IMAGE_ORIGINAL_NOT_FOUND'; END IF;
    v_prefix := v_run.cliente_id::text || '/' || v_run.user_id::text || '/' ||
        v_run.conversation_id::text || '/' || p_run_id::text || '/';
    IF p_storage_path !~ ('^' || v_prefix || 'result-[0-9a-f-]+\.png$')
       OR p_storage_path = v_original.storage_path THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'IMAGE_RESULT_PATH_INVALID';
    END IF;

    INSERT INTO ap.ai_image_assets (
        id, cliente_id, user_id, conversation_id, ai_run_id, kind, source_image_id,
        storage_path, mime_type, file_extension, byte_size, width, height, content_sha256
    ) VALUES (
        p_asset_id, v_run.cliente_id, v_run.user_id, v_run.conversation_id, p_run_id, 'result', v_original.id,
        p_storage_path, p_mime_type, p_file_extension, p_byte_size, p_width, p_height, p_content_sha256
    ) RETURNING * INTO v_result;

    INSERT INTO ap.ai_messages (conversation_id, cliente_id, user_id, role, content, status, ai_run_id)
    VALUES (v_run.conversation_id, v_run.cliente_id, v_run.user_id, 'assistant', p_content, 'completed', p_run_id)
    RETURNING * INTO v_message;

    UPDATE ap.ai_runs SET
        actual_model = p_actual_model,
        provider_request_id = left(p_provider_request_id, 200),
        input_tokens = p_input_tokens,
        input_text_tokens = p_input_text_tokens,
        input_image_tokens = p_input_image_tokens,
        output_tokens = p_output_tokens,
        output_image_tokens = p_output_image_tokens,
        cached_input_tokens = 0,
        cost_estimate = p_cost_estimate,
        currency = 'USD',
        status = 'completed', error_code = NULL,
        latency_ms = p_latency_ms, completed_at = now()
     WHERE id = p_run_id;

    RETURN jsonb_build_object(
        'run_id', p_run_id, 'message_id', v_message.id,
        'asset_id', v_result.id, 'content', v_message.content
    );
END;
$$;

ALTER TABLE ap.ai_image_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE ap.ai_image_assets FORCE ROW LEVEL SECURITY;

CREATE POLICY ai_image_assets_private_select
ON ap.ai_image_assets FOR SELECT TO authenticated
USING (
    user_id = (SELECT auth.uid())
    AND cliente_id = public.require_single_operational_cliente_id()
);

REVOKE ALL ON TABLE ap.ai_image_assets FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE ap.ai_image_assets TO authenticated, service_role;

REVOKE ALL ON FUNCTION ap.claim_ai_image_run(uuid, uuid, uuid, uuid, text, text, text, uuid, text, text)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION ap.register_ai_image_original(uuid, uuid, uuid, uuid, text, text, text, bigint, integer, integer, text)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION ap.complete_ai_image_run(uuid, uuid, text, text, text, bigint, integer, integer, text, text, text, text, bigint, bigint, bigint, bigint, bigint, numeric, bigint)
    FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION ap.claim_ai_image_run(uuid, uuid, uuid, uuid, text, text, text, uuid, text, text)
    TO service_role;
GRANT EXECUTE ON FUNCTION ap.register_ai_image_original(uuid, uuid, uuid, uuid, text, text, text, bigint, integer, integer, text)
    TO service_role;
GRANT EXECUTE ON FUNCTION ap.complete_ai_image_run(uuid, uuid, text, text, text, bigint, integer, integer, text, text, text, text, bigint, bigint, bigint, bigint, bigint, numeric, bigint)
    TO service_role;

COMMENT ON TABLE ap.ai_image_assets IS
    'Private immutable original/result metadata for native chat image edits; binary data stays in private Storage.';
