-- Private, tenant-bound storage for the native AI chat.
-- This migration does not connect chat output to the article generator or any
-- AutoPublisher production table.

CREATE UNIQUE INDEX IF NOT EXISTS editorial_prompt_versions_id_cliente_idx
    ON ap.editorial_prompt_versions (id, cliente_id);

CREATE TABLE ap.ai_conversations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cliente_id uuid NOT NULL REFERENCES public.clientes(id) ON DELETE RESTRICT,
    user_id uuid NOT NULL REFERENCES public.profissionais(id) ON DELETE RESTRICT,
    title text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    archived_at timestamptz,
    CONSTRAINT ai_conversations_title_check
        CHECK (length(btrim(title)) BETWEEN 1 AND 160),
    CONSTRAINT ai_conversations_archived_at_check
        CHECK (archived_at IS NULL OR archived_at >= created_at),
    CONSTRAINT ai_conversations_identity_key UNIQUE (id, cliente_id, user_id)
);

CREATE TABLE ap.ai_runs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id uuid NOT NULL,
    cliente_id uuid NOT NULL REFERENCES public.clientes(id) ON DELETE RESTRICT,
    user_id uuid NOT NULL REFERENCES public.profissionais(id) ON DELETE RESTRICT,
    conversation_id uuid NOT NULL,
    operation text NOT NULL DEFAULT 'chat',
    provider text NOT NULL DEFAULT 'openai',
    requested_model text NOT NULL,
    actual_model text,
    prompt_version_id uuid NOT NULL,
    prompt_hash text NOT NULL,
    pricing_version text NOT NULL,
    input_tokens bigint NOT NULL DEFAULT 0,
    cached_input_tokens bigint NOT NULL DEFAULT 0,
    output_tokens bigint NOT NULL DEFAULT 0,
    cost_estimate numeric(18,8),
    currency text NOT NULL DEFAULT 'USD',
    status text NOT NULL DEFAULT 'running',
    provider_request_id text,
    latency_ms bigint,
    error_code text,
    attempt_count integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    CONSTRAINT ai_runs_conversation_fk
        FOREIGN KEY (conversation_id, cliente_id, user_id)
        REFERENCES ap.ai_conversations(id, cliente_id, user_id)
        ON DELETE RESTRICT,
    CONSTRAINT ai_runs_prompt_version_fk
        FOREIGN KEY (prompt_version_id, cliente_id)
        REFERENCES ap.editorial_prompt_versions(id, cliente_id)
        ON DELETE RESTRICT,
    CONSTRAINT ai_runs_operation_check CHECK (operation = 'chat'),
    CONSTRAINT ai_runs_provider_check CHECK (provider = 'openai'),
    CONSTRAINT ai_runs_requested_model_check CHECK (length(btrim(requested_model)) BETWEEN 1 AND 120),
    CONSTRAINT ai_runs_actual_model_check CHECK (actual_model IS NULL OR length(btrim(actual_model)) BETWEEN 1 AND 120),
    CONSTRAINT ai_runs_prompt_hash_check CHECK (prompt_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT ai_runs_pricing_version_check CHECK (length(btrim(pricing_version)) BETWEEN 1 AND 80),
    CONSTRAINT ai_runs_usage_check CHECK (
        input_tokens >= 0 AND cached_input_tokens >= 0
        AND cached_input_tokens <= input_tokens AND output_tokens >= 0
    ),
    CONSTRAINT ai_runs_cost_check CHECK (cost_estimate IS NULL OR cost_estimate >= 0),
    CONSTRAINT ai_runs_currency_check CHECK (currency = 'USD'),
    CONSTRAINT ai_runs_status_check CHECK (status IN ('running', 'completed', 'failed')),
    CONSTRAINT ai_runs_error_code_check CHECK (
        error_code IS NULL OR error_code ~ '^[A-Z0-9_:-]{1,80}$'
    ),
    CONSTRAINT ai_runs_attempt_count_check CHECK (attempt_count BETWEEN 1 AND 10),
    CONSTRAINT ai_runs_latency_check CHECK (latency_ms IS NULL OR latency_ms >= 0),
    CONSTRAINT ai_runs_completed_at_check CHECK (
        (status = 'running' AND completed_at IS NULL)
        OR (status IN ('completed', 'failed') AND completed_at IS NOT NULL)
    ),
    CONSTRAINT ai_runs_request_owner_key UNIQUE (user_id, request_id),
    CONSTRAINT ai_runs_identity_key UNIQUE (id, conversation_id, cliente_id, user_id)
);

CREATE TABLE ap.ai_messages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id uuid NOT NULL,
    cliente_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text NOT NULL,
    content text NOT NULL,
    status text NOT NULL DEFAULT 'completed',
    ai_run_id uuid,
    sequence_no bigint GENERATED ALWAYS AS IDENTITY,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ai_messages_conversation_fk
        FOREIGN KEY (conversation_id, cliente_id, user_id)
        REFERENCES ap.ai_conversations(id, cliente_id, user_id)
        ON DELETE RESTRICT,
    CONSTRAINT ai_messages_run_fk
        FOREIGN KEY (ai_run_id, conversation_id, cliente_id, user_id)
        REFERENCES ap.ai_runs(id, conversation_id, cliente_id, user_id)
        ON DELETE RESTRICT,
    CONSTRAINT ai_messages_role_check CHECK (role IN ('user', 'assistant')),
    CONSTRAINT ai_messages_content_check CHECK (length(btrim(content)) BETWEEN 1 AND 50000),
    CONSTRAINT ai_messages_status_check CHECK (status IN ('completed', 'failed')),
    CONSTRAINT ai_messages_conversation_sequence_key UNIQUE (conversation_id, sequence_no)
);

CREATE UNIQUE INDEX ai_messages_one_role_per_run_idx
    ON ap.ai_messages (ai_run_id, role)
    WHERE ai_run_id IS NOT NULL;

CREATE INDEX ai_conversations_owner_updated_idx
    ON ap.ai_conversations (cliente_id, user_id, updated_at DESC);
CREATE INDEX ai_messages_history_idx
    ON ap.ai_messages (conversation_id, sequence_no);
CREATE INDEX ai_runs_owner_created_idx
    ON ap.ai_runs (cliente_id, user_id, created_at DESC);

CREATE OR REPLACE FUNCTION ap.touch_ai_conversation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    UPDATE ap.ai_conversations
       SET updated_at = GREATEST(updated_at, NEW.created_at)
     WHERE id = NEW.conversation_id
       AND cliente_id = NEW.cliente_id
       AND user_id = NEW.user_id;
    RETURN NEW;
END;
$$;

CREATE TRIGGER ai_messages_touch_conversation
AFTER INSERT ON ap.ai_messages
FOR EACH ROW EXECUTE FUNCTION ap.touch_ai_conversation();

-- Atomically claim an idempotent request and persist its user message. Tenant
-- and user values are accepted only from the authenticated Edge Function and
-- this RPC is executable only by service_role.
CREATE OR REPLACE FUNCTION ap.claim_ai_chat_run(
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
    v_existing_conversation ap.ai_conversations%ROWTYPE;
    v_claimed boolean := false;
BEGIN
    IF p_request_id IS NULL OR p_cliente_id IS NULL OR p_user_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'CHAT_IDENTITY_REQUIRED';
    END IF;
    IF length(btrim(COALESCE(p_content, ''))) NOT BETWEEN 1 AND 50000 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'CHAT_CONTENT_INVALID';
    END IF;

    SELECT * INTO v_run
      FROM ap.ai_runs
     WHERE user_id = p_user_id AND request_id = p_request_id
     FOR UPDATE;

    IF FOUND THEN
        IF v_run.cliente_id <> p_cliente_id
           OR v_run.conversation_id <> v_conversation_id
           OR v_run.operation <> 'chat'
           OR v_run.provider <> 'openai' THEN
            RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'CHAT_REQUEST_SCOPE_MISMATCH';
        END IF;

        IF v_run.status = 'failed' THEN
            IF v_run.prompt_version_id <> p_prompt_version_id
               OR v_run.prompt_hash <> p_prompt_hash
               OR v_run.requested_model <> p_requested_model
               OR v_run.pricing_version <> p_pricing_version THEN
                RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'CHAT_RETRY_CONTEXT_CHANGED';
            END IF;
            IF v_run.attempt_count >= 10 THEN
                RAISE EXCEPTION USING ERRCODE = '54000', MESSAGE = 'CHAT_RETRY_LIMIT';
            END IF;
            UPDATE ap.ai_runs
               SET status = 'running', completed_at = NULL, error_code = NULL,
                   provider_request_id = NULL, latency_ms = NULL,
                   attempt_count = attempt_count + 1
             WHERE id = v_run.id
             RETURNING * INTO v_run;
            v_claimed := true;
        END IF;
    ELSE
        INSERT INTO ap.ai_conversations (id, cliente_id, user_id, title)
        VALUES (
            v_conversation_id,
            p_cliente_id,
            p_user_id,
            left(COALESCE(NULLIF(btrim(p_title), ''), left(btrim(p_content), 80)), 160)
        )
        ON CONFLICT (id) DO NOTHING;

        SELECT * INTO v_existing_conversation
          FROM ap.ai_conversations
         WHERE id = v_conversation_id
         FOR UPDATE;
        IF NOT FOUND
           OR v_existing_conversation.cliente_id <> p_cliente_id
           OR v_existing_conversation.user_id <> p_user_id
           OR v_existing_conversation.archived_at IS NOT NULL THEN
            RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'CHAT_CONVERSATION_FORBIDDEN';
        END IF;

        IF v_existing_conversation.title = 'Nova conversa'
           AND length(btrim(COALESCE(p_title, ''))) BETWEEN 1 AND 160
           AND NOT EXISTS (
               SELECT 1 FROM ap.ai_messages AS message
                WHERE message.conversation_id = v_existing_conversation.id
           ) THEN
            UPDATE ap.ai_conversations
               SET title = left(btrim(p_title), 160), updated_at = now()
             WHERE id = v_existing_conversation.id
               AND cliente_id = p_cliente_id
               AND user_id = p_user_id;
        END IF;

        INSERT INTO ap.ai_runs (
            request_id, cliente_id, user_id, conversation_id,
            operation, provider, requested_model,
            prompt_version_id, prompt_hash, pricing_version, status
        ) VALUES (
            p_request_id, p_cliente_id, p_user_id, v_conversation_id,
            'chat', 'openai', p_requested_model,
            p_prompt_version_id, p_prompt_hash, p_pricing_version, 'running'
        )
        RETURNING * INTO v_run;
        v_claimed := true;
    END IF;

    INSERT INTO ap.ai_messages (
        conversation_id, cliente_id, user_id, role, content, status, ai_run_id
    ) VALUES (
        v_run.conversation_id, v_run.cliente_id, v_run.user_id,
        'user', p_content, 'completed', v_run.id
    )
    ON CONFLICT (ai_run_id, role) WHERE ai_run_id IS NOT NULL DO NOTHING;

    RETURN jsonb_build_object(
        'run_id', v_run.id,
        'conversation_id', v_run.conversation_id,
        'status', v_run.status,
        'claimed', v_claimed
    );
END;
$$;

-- Assistant message and terminal usage are committed in one transaction.
CREATE OR REPLACE FUNCTION ap.complete_ai_chat_run(
    p_run_id uuid,
    p_content text,
    p_actual_model text,
    p_provider_request_id text,
    p_input_tokens bigint,
    p_cached_input_tokens bigint,
    p_output_tokens bigint,
    p_cost_estimate numeric,
    p_currency text,
    p_latency_ms bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_run ap.ai_runs%ROWTYPE;
    v_message ap.ai_messages%ROWTYPE;
BEGIN
    SELECT * INTO v_run FROM ap.ai_runs WHERE id = p_run_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'CHAT_RUN_NOT_FOUND';
    END IF;

    IF v_run.status = 'completed' THEN
        SELECT * INTO v_message
          FROM ap.ai_messages
         WHERE ai_run_id = v_run.id AND role = 'assistant';
        RETURN jsonb_build_object('run_id', v_run.id, 'message_id', v_message.id, 'content', v_message.content);
    END IF;
    IF v_run.status <> 'running' THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'CHAT_RUN_NOT_RUNNING';
    END IF;
    IF length(btrim(COALESCE(p_content, ''))) NOT BETWEEN 1 AND 50000 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'CHAT_RESPONSE_INVALID';
    END IF;

    INSERT INTO ap.ai_messages (
        conversation_id, cliente_id, user_id, role, content, status, ai_run_id
    ) VALUES (
        v_run.conversation_id, v_run.cliente_id, v_run.user_id,
        'assistant', p_content, 'completed', v_run.id
    )
    ON CONFLICT (ai_run_id, role) WHERE ai_run_id IS NOT NULL DO NOTHING
    RETURNING * INTO v_message;

    IF v_message.id IS NULL THEN
        SELECT * INTO v_message
          FROM ap.ai_messages
         WHERE ai_run_id = v_run.id AND role = 'assistant';
    END IF;

    UPDATE ap.ai_runs
       SET actual_model = p_actual_model,
           provider_request_id = left(p_provider_request_id, 200),
           input_tokens = p_input_tokens,
           cached_input_tokens = p_cached_input_tokens,
           output_tokens = p_output_tokens,
           cost_estimate = p_cost_estimate,
           currency = p_currency,
           status = 'completed',
           error_code = NULL,
           latency_ms = p_latency_ms,
           completed_at = now()
     WHERE id = v_run.id;

    RETURN jsonb_build_object('run_id', v_run.id, 'message_id', v_message.id, 'content', v_message.content);
END;
$$;

CREATE OR REPLACE FUNCTION ap.fail_ai_chat_run(
    p_run_id uuid,
    p_error_code text,
    p_latency_ms bigint
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    UPDATE ap.ai_runs
       SET status = 'failed',
           error_code = CASE
               WHEN p_error_code ~ '^[A-Z0-9_:-]{1,80}$' THEN p_error_code
               ELSE 'CHAT_PROVIDER_ERROR'
           END,
           latency_ms = GREATEST(COALESCE(p_latency_ms, 0), 0),
           completed_at = now()
     WHERE id = p_run_id AND status = 'running';
END;
$$;

ALTER TABLE ap.ai_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE ap.ai_conversations FORCE ROW LEVEL SECURITY;
ALTER TABLE ap.ai_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE ap.ai_messages FORCE ROW LEVEL SECURITY;
ALTER TABLE ap.ai_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ap.ai_runs FORCE ROW LEVEL SECURITY;

CREATE POLICY ai_conversations_private_select
ON ap.ai_conversations FOR SELECT TO authenticated
USING (
    user_id = (SELECT auth.uid())
    AND cliente_id = public.require_single_operational_cliente_id()
);

CREATE POLICY ai_messages_private_select
ON ap.ai_messages FOR SELECT TO authenticated
USING (
    user_id = (SELECT auth.uid())
    AND cliente_id = public.require_single_operational_cliente_id()
);

CREATE POLICY ai_runs_private_select
ON ap.ai_runs FOR SELECT TO authenticated
USING (
    user_id = (SELECT auth.uid())
    AND cliente_id = public.require_single_operational_cliente_id()
);

REVOKE ALL ON TABLE ap.ai_conversations, ap.ai_messages, ap.ai_runs
    FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE ap.ai_conversations, ap.ai_messages, ap.ai_runs
    TO authenticated;
GRANT SELECT ON TABLE ap.ai_conversations, ap.ai_messages, ap.ai_runs
    TO service_role;

REVOKE ALL ON SEQUENCE ap.ai_messages_sequence_no_seq
    FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION ap.touch_ai_conversation() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION ap.claim_ai_chat_run(uuid, uuid, uuid, uuid, text, text, text, uuid, text, text)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION ap.complete_ai_chat_run(uuid, text, text, text, bigint, bigint, bigint, numeric, text, bigint)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION ap.fail_ai_chat_run(uuid, text, bigint)
    FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION ap.claim_ai_chat_run(uuid, uuid, uuid, uuid, text, text, text, uuid, text, text)
    TO service_role;
GRANT EXECUTE ON FUNCTION ap.complete_ai_chat_run(uuid, text, text, text, bigint, bigint, bigint, numeric, text, bigint)
    TO service_role;
GRANT EXECUTE ON FUNCTION ap.fail_ai_chat_run(uuid, text, bigint)
    TO service_role;

COMMENT ON TABLE ap.ai_conversations IS
    'Private native-chat conversations. Tenant admins have no implicit access to other users chats.';
COMMENT ON TABLE ap.ai_messages IS
    'Private chat history. Content is not copied to shared editorial logs.';
COMMENT ON TABLE ap.ai_runs IS
    'Per-request OpenAI usage, cost estimate and prompt trace without prompt or user-content snapshots.';
