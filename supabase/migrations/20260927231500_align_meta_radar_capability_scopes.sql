-- Persisted Meta capabilities must use the same fail-closed Radar read contract
-- as the OAuth runtime: all four read/discovery scopes are required.
CREATE OR REPLACE FUNCTION ap.complete_meta_oauth_connection(
    p_user_id uuid, p_cliente_id uuid, p_graph_api_version text,
    p_facebook_user_id text, p_user_access_token text, p_user_token_expires_at timestamptz,
    p_granted_scopes text[], p_flow_started_at timestamptz, p_authorization_epoch bigint,
    p_page jsonb
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_epoch bigint; v_user_secret_ref uuid; v_page_secret_ref uuid;
DECLARE v_result jsonb;
DECLARE v_page_id text := p_page ->> 'facebook_page_id';
DECLARE v_page_name text := p_page ->> 'facebook_page_name';
DECLARE v_instagram_user_id text := p_page ->> 'instagram_user_id';
DECLARE v_instagram_username text := p_page ->> 'instagram_username';
DECLARE v_page_access_token text := p_page ->> 'page_access_token';
BEGIN
    IF session_user <> 'postgres' AND COALESCE(auth.jwt() ->> 'role', '') <> 'service_role' THEN
      RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED' USING ERRCODE = '42501';
    END IF;
    IF NOT ap.revalidate_meta_connection_actor(p_user_id, p_cliente_id) THEN
      RAISE EXCEPTION 'META_ACTOR_NOT_AUTHORIZED' USING ERRCODE = '42501';
    END IF;
    IF p_authorization_epoch IS NULL OR COALESCE(v_page_id, '') = ''
       OR COALESCE(v_page_name, '') = '' OR COALESCE(v_instagram_user_id, '') = ''
       OR COALESCE(v_instagram_username, '') = '' OR COALESCE(v_page_access_token, '') = '' THEN
      RAISE EXCEPTION 'META_CONNECTION_INVALID' USING ERRCODE = '22023';
    END IF;
    v_epoch := ap.meta_lock_authorization(
      p_facebook_user_id, p_flow_started_at, p_authorization_epoch
    );
    v_user_secret_ref := ap.meta_create_secret(
      p_user_access_token,
      'ap_meta_user_' || replace(gen_random_uuid()::text, '-', ''),
      'Meta OAuth user token owned by active connection'
    );
    v_page_secret_ref := ap.meta_create_secret(
      v_page_access_token,
      'ap_meta_page_' || replace(gen_random_uuid()::text, '-', ''),
      'Meta Page access token owned by active connection'
    );
    SELECT ap.reconnect_meta_connection(
      p_cliente_id, p_user_id, p_facebook_user_id, v_instagram_user_id,
      v_instagram_username, v_page_id, v_page_name, v_page_secret_ref,
      v_user_secret_ref, COALESCE(p_granted_scopes, ARRAY[]::text[]),
      jsonb_build_object(
        'radar_read', COALESCE(p_granted_scopes, ARRAY[]::text[]) @> ARRAY['pages_show_list','pages_read_engagement','instagram_basic','business_management']::text[],
        'publishing', COALESCE(p_granted_scopes, ARRAY[]::text[]) @> ARRAY['instagram_content_publish']::text[],
        'comments', COALESCE(p_granted_scopes, ARRAY[]::text[]) @> ARRAY['instagram_manage_comments']::text[],
        'messages', COALESCE(p_granted_scopes, ARRAY[]::text[]) @> ARRAY['instagram_manage_messages']::text[]
      ), p_graph_api_version, p_user_token_expires_at, p_flow_started_at, v_epoch
    ) INTO v_result;
    RETURN v_result;
END; $$;

CREATE OR REPLACE FUNCTION ap.select_meta_oauth_candidate(
    p_candidate_id uuid,
    p_actor_user_id uuid,
    p_cliente_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_session ap.meta_oauth_selection_sessions%ROWTYPE;
DECLARE v_candidate ap.meta_oauth_selection_candidates%ROWTYPE;
DECLARE v_other record; v_result jsonb;
BEGIN
    IF session_user <> 'postgres' AND COALESCE(auth.jwt() ->> 'role', '') <> 'service_role' THEN
        RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED' USING ERRCODE = '42501';
    END IF;
    SELECT s.* INTO v_session FROM ap.meta_oauth_selection_candidates c
      JOIN ap.meta_oauth_selection_sessions s ON s.id = c.session_id
      WHERE c.id = p_candidate_id FOR UPDATE OF s;
    IF NOT FOUND THEN RAISE EXCEPTION 'META_SELECTION_INVALID' USING ERRCODE = '22023'; END IF;
    SELECT * INTO v_candidate FROM ap.meta_oauth_selection_candidates
      WHERE id = p_candidate_id AND session_id = v_session.id FOR UPDATE;
    IF v_session.user_id <> p_actor_user_id OR v_session.cliente_id <> p_cliente_id
       OR NOT ap.revalidate_meta_connection_actor(p_actor_user_id, p_cliente_id) THEN
      RAISE EXCEPTION 'META_SELECTION_INVALID' USING ERRCODE = '42501';
    END IF;
    IF v_session.consumed_at IS NOT NULL THEN
      RAISE EXCEPTION 'META_SELECTION_ALREADY_CONSUMED' USING ERRCODE = '28000';
    END IF;
    IF v_session.expires_at <= now() THEN
      RAISE EXCEPTION 'META_SELECTION_EXPIRED' USING ERRCODE = '28000';
    END IF;
    SELECT ap.reconnect_meta_connection(
      p_cliente_id, p_actor_user_id, v_session.facebook_user_id, v_candidate.instagram_user_id,
      v_candidate.instagram_username, v_candidate.facebook_page_id, v_candidate.facebook_page_name,
      v_candidate.page_token_secret_ref, v_session.user_token_secret_ref, v_session.granted_scopes,
      jsonb_build_object(
        'radar_read', v_session.granted_scopes @> ARRAY['pages_show_list','pages_read_engagement','instagram_basic','business_management']::text[],
        'publishing', v_session.granted_scopes @> ARRAY['instagram_content_publish']::text[],
        'comments', v_session.granted_scopes @> ARRAY['instagram_manage_comments']::text[],
        'messages', v_session.granted_scopes @> ARRAY['instagram_manage_messages']::text[]
      ), v_session.graph_api_version, v_session.user_token_expires_at,
      v_session.flow_started_at, v_session.authorization_epoch
    ) INTO v_result;
    FOR v_other IN SELECT id, page_token_secret_ref FROM ap.meta_oauth_selection_candidates
      WHERE session_id = v_session.id AND id <> v_candidate.id FOR UPDATE
    LOOP
      IF v_other.page_token_secret_ref IS DISTINCT FROM v_candidate.page_token_secret_ref THEN
        PERFORM ap.meta_delete_secret_required(v_other.page_token_secret_ref);
      END IF;
    END LOOP;
    DELETE FROM ap.meta_oauth_selection_candidates WHERE session_id = v_session.id AND id <> v_candidate.id;
    UPDATE ap.meta_oauth_selection_sessions SET consumed_at = now()
      WHERE id = v_session.id AND consumed_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'META_SELECTION_ALREADY_CONSUMED' USING ERRCODE = '28000'; END IF;
    RETURN v_result;
END; $$;
