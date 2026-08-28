-- Optional administrative context for a collected item entering the shared
-- news backlog. Keep the two-argument approval RPC intact for compatibility;
-- this three-argument overload is explicit so existing callers stay unambiguous.

CREATE OR REPLACE FUNCTION ap.approve_collected_news(
    p_cliente_id uuid,
    p_collected_news_id uuid,
    p_observacao text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_actor record;
    v_collected ap.collected_news%ROWTYPE;
    v_existing ap.news_backlog%ROWTYPE;
    v_backlog ap.news_backlog%ROWTYPE;
    v_observacao text := NULLIF(btrim(p_observacao), '');
BEGIN
    SELECT * INTO v_actor FROM ap.require_editorial_admin_access(p_cliente_id);

    SELECT * INTO v_collected
    FROM ap.collected_news AS collected
    WHERE collected.id = p_collected_news_id
      AND collected.cliente_id = p_cliente_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'COLLECTED_NEWS_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    IF v_collected.status = 'approved' AND v_collected.news_backlog_id IS NOT NULL THEN
        SELECT * INTO v_backlog FROM ap.news_backlog WHERE id = v_collected.news_backlog_id;
        RETURN jsonb_build_object('created', false, 'item', to_jsonb(v_backlog));
    END IF;
    IF v_collected.status <> 'pending_review' THEN
        RAISE EXCEPTION 'COLLECTED_NEWS_NOT_PENDING' USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_existing
    FROM ap.news_backlog AS backlog
    WHERE backlog.cliente_id = p_cliente_id
      AND backlog.normalized_url = v_collected.normalized_url;

    IF FOUND THEN
        UPDATE ap.collected_news
           SET status = 'duplicate', updated_at = now(),
               metadata = metadata || jsonb_build_object('duplicate_backlog_id', v_existing.id)
         WHERE id = v_collected.id;
        INSERT INTO ap.collected_news_events (
            collected_news_id, cliente_id, actor_user_id, action, metadata
        ) VALUES (
            v_collected.id, p_cliente_id, v_actor.user_id, 'duplicate',
            jsonb_build_object('backlog_id', v_existing.id)
        );
        RETURN jsonb_build_object(
            'created', false,
            'duplicate', true,
            'item', to_jsonb(v_existing)
        );
    END IF;

    INSERT INTO ap.news_backlog (
        cliente_id, url_original, normalized_url, url_normalization_version,
        titulo, observacao, origem, status,
        created_by_user_id, created_by_name_snapshot, collected_news_id
    ) VALUES (
        p_cliente_id, v_collected.canonical_url, v_collected.normalized_url, 1,
        v_collected.title, COALESCE(v_observacao, NULLIF(v_collected.excerpt, '')),
        'scraped_approved', 'available',
        v_actor.user_id, NULLIF(btrim(v_actor.display_name), ''), v_collected.id
    ) RETURNING * INTO v_backlog;

    UPDATE ap.collected_news
       SET status = 'approved',
           approved_by_user_id = v_actor.user_id,
           approved_by_name_snapshot = NULLIF(btrim(v_actor.display_name), ''),
           approved_at = now(),
           news_backlog_id = v_backlog.id
     WHERE id = v_collected.id;

    INSERT INTO ap.collected_news_events (
        collected_news_id, cliente_id, actor_user_id, action, metadata
    ) VALUES (
        v_collected.id, p_cliente_id, v_actor.user_id, 'approved',
        jsonb_build_object('backlog_id', v_backlog.id, 'has_admin_observation', v_observacao IS NOT NULL)
    );
    INSERT INTO ap.news_backlog_events (
        backlog_id, cliente_id, actor_user_id, action, metadata
    ) VALUES (
        v_backlog.id, p_cliente_id, v_actor.user_id, 'approved_from_collection',
        jsonb_build_object('collected_news_id', v_collected.id, 'has_admin_observation', v_observacao IS NOT NULL)
    );

    RETURN jsonb_build_object('created', true, 'item', to_jsonb(v_backlog));
END;
$function$;

REVOKE ALL ON FUNCTION ap.approve_collected_news(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION ap.approve_collected_news(uuid, uuid, text) TO authenticated;

COMMENT ON FUNCTION ap.approve_collected_news(uuid, uuid, text) IS
    'Tenant-safe admin approval that optionally stores an administrative observation on the available backlog item.';
