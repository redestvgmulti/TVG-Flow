-- Adds a discard action after the Phase 1A backlog contract. An unclaimed link,
-- or a pauta adopted by the current user, can be archived without touching the
-- candidate_news production pipeline.

ALTER TABLE ap.news_backlog
    DROP CONSTRAINT news_backlog_adoption_consistency_check;

ALTER TABLE ap.news_backlog
    ADD CONSTRAINT news_backlog_adoption_consistency_check
    CHECK (
        (status = 'available' AND adopted_by_user_id IS NULL AND adopted_at IS NULL)
        OR (status = 'adopted' AND adopted_by_user_id IS NOT NULL AND adopted_at IS NOT NULL)
        OR status = 'archived'
    );

ALTER TABLE ap.news_backlog_events
    DROP CONSTRAINT news_backlog_event_action_check;

ALTER TABLE ap.news_backlog_events
    ADD CONSTRAINT news_backlog_event_action_check
    CHECK (action IN ('created', 'adopted', 'released', 'production_started', 'linked', 'discarded'));

CREATE OR REPLACE FUNCTION ap.discard_news_backlog_item(
    p_backlog_id uuid,
    p_cliente_id uuid
)
RETURNS ap.news_backlog
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, ap, public, pg_temp
AS $function$
DECLARE
    v_actor record;
    v_result ap.news_backlog%ROWTYPE;
BEGIN
    SELECT * INTO v_actor FROM ap.require_news_backlog_access(p_cliente_id);

    UPDATE ap.news_backlog AS backlog
       SET status = 'archived'
     WHERE backlog.id = p_backlog_id
       AND backlog.cliente_id = p_cliente_id
       AND backlog.candidate_news_id IS NULL
       AND (
           backlog.status = 'available'
           OR (backlog.status = 'adopted' AND backlog.adopted_by_user_id = v_actor.user_id)
       )
     RETURNING * INTO v_result;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'BACKLOG_DISCARD_FORBIDDEN' USING ERRCODE = '42501';
    END IF;

    INSERT INTO ap.news_backlog_events (backlog_id, cliente_id, actor_user_id, action)
    VALUES (v_result.id, p_cliente_id, v_actor.user_id, 'discarded');

    RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION ap.discard_news_backlog_item(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION ap.discard_news_backlog_item(uuid, uuid) TO authenticated;

COMMENT ON FUNCTION ap.discard_news_backlog_item(uuid, uuid) IS
    'Archives an unclaimed or self-adopted backlog item. Items adopted by someone else, or already in production, cannot be discarded.';

-- Preserve the complete Phase 1A return contract while hiding discarded rows.
CREATE OR REPLACE FUNCTION ap.list_news_backlog(p_cliente_id uuid)
RETURNS TABLE (
    id uuid,
    cliente_id uuid,
    url_original text,
    normalized_url text,
    url_normalization_version smallint,
    titulo text,
    observacao text,
    origem text,
    status text,
    created_by_user_id uuid,
    created_by_name_snapshot text,
    created_at timestamptz,
    adopted_by_user_id uuid,
    adopted_by_name_snapshot text,
    adopted_at timestamptz,
    released_at timestamptz,
    candidate_news_id uuid,
    production_started_at timestamptz,
    updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, ap, public, pg_temp
AS $function$
BEGIN
    PERFORM 1 FROM ap.require_news_backlog_access(p_cliente_id);

    RETURN QUERY
    SELECT
        backlog.id,
        backlog.cliente_id,
        backlog.url_original,
        backlog.normalized_url,
        backlog.url_normalization_version,
        backlog.titulo,
        backlog.observacao,
        backlog.origem,
        backlog.status,
        backlog.created_by_user_id,
        backlog.created_by_name_snapshot,
        backlog.created_at,
        backlog.adopted_by_user_id,
        backlog.adopted_by_name_snapshot,
        backlog.adopted_at,
        backlog.released_at,
        backlog.candidate_news_id,
        backlog.production_started_at,
        backlog.updated_at
    FROM ap.news_backlog AS backlog
    WHERE backlog.cliente_id = p_cliente_id
      AND backlog.status <> 'archived'
    ORDER BY
        CASE backlog.status WHEN 'available' THEN 0 WHEN 'adopted' THEN 1 ELSE 2 END,
        backlog.created_at DESC;
END;
$function$;
