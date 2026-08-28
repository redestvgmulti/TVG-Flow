-- Fase 2: closes editorial visibility/recovery gaps without changing the
-- ingestion, render or publication workers.  All access continues through
-- authenticated, tenant-gated RPCs; browser roles retain no direct table access.

-- The curated-ingestion cutover made super_admin an editorial administrator for
-- a valid active tenant.  Keep the shared backlog on that same canonical rule,
-- while preserving staff access for their own adoption/production work.
CREATE OR REPLACE FUNCTION ap.require_news_backlog_access(p_cliente_id uuid)
RETURNS TABLE (user_id uuid, role text, display_name text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_user_id uuid := auth.uid();
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '28000';
    END IF;

    RETURN QUERY
    SELECT professional.id, professional.role, professional.nome
    FROM public.profissionais AS professional
    WHERE professional.id = v_user_id
      AND professional.ativo IS TRUE
      AND professional.role IN ('admin', 'super_admin', 'staff')
      AND (
          (
              professional.role = 'super_admin'
              AND EXISTS (
                  SELECT 1
                  FROM public.clientes AS client
                  WHERE client.id = p_cliente_id
                    AND client.ativo IS TRUE
              )
          )
          OR EXISTS (
              SELECT 1
              FROM ap.get_operational_cliente_ids() AS allowed(cliente_id)
              WHERE allowed.cliente_id = p_cliente_id
          )
      );

    IF NOT FOUND THEN
        RAISE EXCEPTION 'BACKLOG_TENANT_FORBIDDEN' USING ERRCODE = '42501';
    END IF;
END;
$function$;

-- Administrative recovery is deliberately a return to the shared bank, not a
-- silent reassignment.  It cannot affect an already-created candidate_news.
ALTER TABLE ap.news_backlog_events DROP CONSTRAINT IF EXISTS news_backlog_event_action_check;
ALTER TABLE ap.news_backlog_events
    ADD CONSTRAINT news_backlog_event_action_check
    CHECK (action IN (
        'created', 'approved_from_collection', 'adopted', 'released',
        'admin_released', 'production_started', 'linked', 'production_completed',
        'discarded', 'title_updated'
    ));

CREATE OR REPLACE FUNCTION ap.admin_release_news_backlog_item(
    p_backlog_id uuid,
    p_cliente_id uuid,
    p_reason text DEFAULT NULL
)
RETURNS ap.news_backlog
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_actor record;
    v_before ap.news_backlog%ROWTYPE;
    v_result ap.news_backlog%ROWTYPE;
BEGIN
    SELECT * INTO v_actor FROM ap.require_editorial_admin_access(p_cliente_id);

    SELECT * INTO v_before
    FROM ap.news_backlog AS backlog
    WHERE backlog.id = p_backlog_id
      AND backlog.cliente_id = p_cliente_id
    FOR UPDATE;

    IF NOT FOUND
       OR v_before.status <> 'adopted'
       OR v_before.candidate_news_id IS NOT NULL THEN
        RAISE EXCEPTION 'BACKLOG_ADMIN_RELEASE_NOT_ALLOWED' USING ERRCODE = '42501';
    END IF;

    UPDATE ap.news_backlog AS backlog
       SET status = 'available',
           adopted_by_user_id = NULL,
           adopted_by_name_snapshot = NULL,
           adopted_at = NULL,
           released_by_user_id = v_actor.user_id,
           released_at = now()
     WHERE backlog.id = p_backlog_id
       AND backlog.cliente_id = p_cliente_id
       AND backlog.status = 'adopted'
       AND backlog.candidate_news_id IS NULL
     RETURNING * INTO v_result;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'BACKLOG_ADMIN_RELEASE_NOT_ALLOWED' USING ERRCODE = '42501';
    END IF;

    INSERT INTO ap.news_backlog_events (
        backlog_id, cliente_id, actor_user_id, action, metadata
    ) VALUES (
        v_result.id,
        p_cliente_id,
        v_actor.user_id,
        'admin_released',
        jsonb_strip_nulls(jsonb_build_object(
            'previous_adopted_by_user_id', v_before.adopted_by_user_id,
            'previous_adopted_by_name', v_before.adopted_by_name_snapshot,
            'reason', NULLIF(btrim(p_reason), '')
        ))
    );

    RETURN v_result;
END;
$function$;

-- Current operational view. It derives only from the existing backlog and
-- candidate records and is restricted to editorial administrators.
CREATE OR REPLACE FUNCTION ap.list_team_news_work_details(p_cliente_id uuid)
RETURNS TABLE (
    backlog_id uuid,
    titulo text,
    url_original text,
    origem text,
    backlog_status text,
    adopted_by_user_id uuid,
    adopted_by_name_snapshot text,
    adopted_at timestamptz,
    production_started_at timestamptz,
    production_completed_at timestamptz,
    candidate_news_id uuid,
    candidate_status text,
    candidate_content_type text,
    candidate_created_at timestamptz,
    candidate_render_completed_at timestamptz,
    candidate_published_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
    PERFORM 1 FROM ap.require_editorial_admin_access(p_cliente_id);

    RETURN QUERY
    SELECT
        backlog.id,
        backlog.titulo,
        backlog.url_original,
        backlog.origem,
        backlog.status,
        backlog.adopted_by_user_id,
        backlog.adopted_by_name_snapshot,
        backlog.adopted_at,
        backlog.production_started_at,
        backlog.production_completed_at,
        candidate.id,
        candidate.status,
        candidate.content_type,
        candidate.created_at,
        COALESCE(candidate.render_completed_at, candidate.completed_at),
        candidate.published_at
    FROM ap.news_backlog AS backlog
    LEFT JOIN ap.candidate_news AS candidate ON candidate.id = backlog.candidate_news_id
    WHERE backlog.cliente_id = p_cliente_id
      AND backlog.status IN ('adopted', 'in_production', 'completed')
    ORDER BY backlog.updated_at DESC, backlog.id DESC;
END;
$function$;

-- Publication remains a human administrative action. The compare-and-set keeps
-- a rendered-but-unapproved candidate from being marked posted and gives
-- super_admin the same tenant-scoped path as admin without widening table RLS.
CREATE OR REPLACE FUNCTION ap.mark_candidate_news_posted(
    p_candidate_news_id uuid,
    p_cliente_id uuid
)
RETURNS ap.candidate_news
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_result ap.candidate_news%ROWTYPE;
BEGIN
    PERFORM 1 FROM ap.require_editorial_admin_access(p_cliente_id);

    UPDATE ap.candidate_news AS candidate
       SET status = 'posted',
           published_at = COALESCE(candidate.published_at, now())
     WHERE candidate.id = p_candidate_news_id
       AND candidate.cliente_id = p_cliente_id
       AND candidate.status = 'approved'
     RETURNING * INTO v_result;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'CANDIDATE_POST_INVALID_STATE' USING ERRCODE = 'P0001';
    END IF;

    RETURN v_result;
END;
$function$;

-- This read model reuses the two existing event streams. Candidate timestamps
-- are appended only where the legacy candidate schema already persists them;
-- it intentionally creates no parallel audit table.
CREATE OR REPLACE FUNCTION ap.list_news_backlog_timeline(
    p_backlog_id uuid,
    p_cliente_id uuid
)
RETURNS TABLE (
    event_at timestamptz,
    event_scope text,
    action text,
    actor_name text,
    metadata jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
    PERFORM 1 FROM ap.require_editorial_admin_access(p_cliente_id);

    IF NOT EXISTS (
        SELECT 1 FROM ap.news_backlog AS backlog
        WHERE backlog.id = p_backlog_id
          AND backlog.cliente_id = p_cliente_id
    ) THEN
        RAISE EXCEPTION 'BACKLOG_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;

    RETURN QUERY
    SELECT event.created_at, 'collection', event.action,
           COALESCE(professional.nome, 'Coletor automático'), event.metadata
    FROM ap.collected_news_events AS event
    JOIN ap.news_backlog AS backlog ON backlog.collected_news_id = event.collected_news_id
    LEFT JOIN public.profissionais AS professional ON professional.id = event.actor_user_id
    WHERE backlog.id = p_backlog_id
      AND event.cliente_id = p_cliente_id

    UNION ALL

    SELECT event.created_at, 'backlog', event.action,
           COALESCE(professional.nome, 'Sistema'), event.metadata
    FROM ap.news_backlog_events AS event
    LEFT JOIN public.profissionais AS professional ON professional.id = event.actor_user_id
    WHERE event.backlog_id = p_backlog_id
      AND event.cliente_id = p_cliente_id

    UNION ALL

    SELECT candidate.created_at, 'production', 'candidate_created',
           COALESCE(candidate.creator_name_snapshot, 'Sistema'),
           jsonb_build_object('candidate_news_id', candidate.id)
    FROM ap.news_backlog AS backlog
    JOIN ap.candidate_news AS candidate ON candidate.id = backlog.candidate_news_id
    WHERE backlog.id = p_backlog_id
      AND backlog.cliente_id = p_cliente_id

    UNION ALL

    SELECT COALESCE(candidate.render_completed_at, candidate.completed_at),
           'production', 'render_completed',
           COALESCE(candidate.creator_name_snapshot, 'Sistema'),
           jsonb_build_object('candidate_news_id', candidate.id, 'status', candidate.status)
    FROM ap.news_backlog AS backlog
    JOIN ap.candidate_news AS candidate ON candidate.id = backlog.candidate_news_id
    WHERE backlog.id = p_backlog_id
      AND backlog.cliente_id = p_cliente_id
      AND COALESCE(candidate.render_completed_at, candidate.completed_at) IS NOT NULL

    UNION ALL

    SELECT candidate.published_at, 'publication', 'posted', NULL,
           jsonb_build_object('candidate_news_id', candidate.id)
    FROM ap.news_backlog AS backlog
    JOIN ap.candidate_news AS candidate ON candidate.id = backlog.candidate_news_id
    WHERE backlog.id = p_backlog_id
      AND backlog.cliente_id = p_cliente_id
      AND candidate.status = 'posted'
      AND candidate.published_at IS NOT NULL

    ORDER BY 1 ASC NULLS LAST;
END;
$function$;

REVOKE ALL ON FUNCTION ap.admin_release_news_backlog_item(uuid, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION ap.list_team_news_work_details(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION ap.list_news_backlog_timeline(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION ap.mark_candidate_news_posted(uuid, uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION ap.admin_release_news_backlog_item(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION ap.list_team_news_work_details(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION ap.list_news_backlog_timeline(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION ap.mark_candidate_news_posted(uuid, uuid) TO authenticated;
