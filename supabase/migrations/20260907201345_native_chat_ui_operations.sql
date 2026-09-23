-- Narrow service-only mutations required by the native chat UI. Identity and
-- tenant are resolved by ai-chat before these functions are invoked.

CREATE OR REPLACE FUNCTION ap.create_ai_conversation(
    p_conversation_id uuid,
    p_cliente_id uuid,
    p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_conversation ap.ai_conversations%ROWTYPE;
BEGIN
    IF p_conversation_id IS NULL OR p_cliente_id IS NULL OR p_user_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'CHAT_IDENTITY_REQUIRED';
    END IF;

    INSERT INTO ap.ai_conversations (id, cliente_id, user_id, title)
    VALUES (p_conversation_id, p_cliente_id, p_user_id, 'Nova conversa')
    ON CONFLICT (id) DO NOTHING;

    SELECT * INTO v_conversation
      FROM ap.ai_conversations
     WHERE id = p_conversation_id;

    IF NOT FOUND
       OR v_conversation.cliente_id <> p_cliente_id
       OR v_conversation.user_id <> p_user_id
       OR v_conversation.archived_at IS NOT NULL THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'CHAT_CONVERSATION_FORBIDDEN';
    END IF;

    RETURN jsonb_build_object(
        'id', v_conversation.id,
        'title', v_conversation.title,
        'created_at', v_conversation.created_at,
        'updated_at', v_conversation.updated_at
    );
END;
$$;

CREATE OR REPLACE FUNCTION ap.archive_ai_conversation(
    p_conversation_id uuid,
    p_cliente_id uuid,
    p_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_archived boolean;
BEGIN
    UPDATE ap.ai_conversations
       SET archived_at = COALESCE(archived_at, now()), updated_at = now()
     WHERE id = p_conversation_id
       AND cliente_id = p_cliente_id
       AND user_id = p_user_id
     RETURNING true INTO v_archived;

    RETURN COALESCE(v_archived, false);
END;
$$;

REVOKE ALL ON FUNCTION ap.create_ai_conversation(uuid, uuid, uuid)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION ap.archive_ai_conversation(uuid, uuid, uuid)
    FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION ap.create_ai_conversation(uuid, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION ap.archive_ai_conversation(uuid, uuid, uuid) TO service_role;
