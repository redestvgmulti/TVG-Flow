-- The Banco de Materias is a chronological intake queue: the first submitted
-- link must remain at the top regardless of its adoption state.
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
    ORDER BY backlog.created_at ASC, backlog.id ASC;
END;
$function$;
