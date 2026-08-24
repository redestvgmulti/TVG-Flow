-- A pauta precisa de um título editorial legível antes de entrar no banco.
-- A captura do título acontece no cliente via o extrator interno; esta RPC
-- permite corrigir registros antigos sem expor acesso direto à tabela.

ALTER TABLE ap.news_backlog_events DROP CONSTRAINT news_backlog_event_action_check;
ALTER TABLE ap.news_backlog_events ADD CONSTRAINT news_backlog_event_action_check
    CHECK (action IN ('created', 'adopted', 'released', 'production_started', 'discarded', 'title_updated'));

CREATE OR REPLACE FUNCTION ap.update_news_backlog_title(
    p_backlog_id uuid,
    p_cliente_id uuid,
    p_titulo text
)
RETURNS ap.news_backlog
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, ap, public, pg_temp
AS $function$
DECLARE
    v_actor record;
    v_title text := btrim(COALESCE(p_titulo, ''));
    v_result ap.news_backlog%ROWTYPE;
BEGIN
    SELECT * INTO v_actor FROM ap.require_news_backlog_access(p_cliente_id);

    IF length(v_title) < 3 OR length(v_title) > 240 THEN
        RAISE EXCEPTION 'BACKLOG_TITLE_INVALID' USING ERRCODE = '22023';
    END IF;

    UPDATE ap.news_backlog AS backlog
    SET titulo = v_title
    WHERE backlog.id = p_backlog_id
      AND backlog.cliente_id = p_cliente_id
      AND backlog.status <> 'archived'
      AND (backlog.status = 'available' OR backlog.adopted_by_user_id = v_actor.user_id)
    RETURNING * INTO v_result;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'BACKLOG_TITLE_UPDATE_FORBIDDEN' USING ERRCODE = '42501';
    END IF;

    INSERT INTO ap.news_backlog_events (backlog_id, cliente_id, actor_user_id, action, metadata)
    VALUES (
        v_result.id,
        p_cliente_id,
        v_actor.user_id,
        'title_updated',
        jsonb_build_object('title_length', length(v_title))
    );

    RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION ap.update_news_backlog_title(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION ap.update_news_backlog_title(uuid, uuid, text) TO authenticated;

COMMENT ON FUNCTION ap.update_news_backlog_title(uuid, uuid, text) IS
    'Updates a readable title for an available backlog item or one adopted by the calling user.';
