-- Adds explicit editorial operations to the private native chat. Output remains
-- in ai_messages and is not connected to production or publishing tables.

ALTER TABLE ap.ai_runs DROP CONSTRAINT ai_runs_operation_check;
ALTER TABLE ap.ai_runs ADD CONSTRAINT ai_runs_operation_check CHECK (
    operation IN (
        'chat',
        'generate_from_link',
        'rewrite',
        'improve_title',
        'correct',
        'summarize',
        'variations'
    )
);

REVOKE ALL ON FUNCTION ap.claim_ai_chat_run(uuid, uuid, uuid, uuid, text, text, text, uuid, text, text)
    FROM PUBLIC, anon, authenticated, service_role;
DROP FUNCTION ap.claim_ai_chat_run(uuid, uuid, uuid, uuid, text, text, text, uuid, text, text);

CREATE FUNCTION ap.claim_ai_chat_run(
    p_request_id uuid,
    p_operation text,
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
    IF p_operation NOT IN (
        'chat', 'generate_from_link', 'rewrite', 'improve_title',
        'correct', 'summarize', 'variations'
    ) THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'CHAT_OPERATION_UNSUPPORTED';
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
           OR v_run.operation <> p_operation
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
            p_operation, 'openai', p_requested_model,
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

REVOKE ALL ON FUNCTION ap.claim_ai_chat_run(uuid, text, uuid, uuid, uuid, text, text, text, uuid, text, text)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION ap.claim_ai_chat_run(uuid, text, uuid, uuid, uuid, text, text, text, uuid, text, text)
    TO service_role;

COMMENT ON CONSTRAINT ai_runs_operation_check ON ap.ai_runs IS
    'Server-selected native-chat operation; every action remains private and non-publishing.';
