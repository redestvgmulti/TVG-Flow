-- R1 / Migration 4: reporting bridge + editorial read for MyNewsWork.
-- Bridges legacy material_production_events and R1 editorial_articles in
-- get_staff_productivity_report, and provides list_my_editorial_articles for
-- authenticated users with tenant isolation.
-- This migration intentionally does not create or mutate candidate_news.
BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Evolve ap.get_staff_productivity_report
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ap.get_staff_productivity_report(
    p_cliente_id uuid,
    p_start timestamptz,
    p_end timestamptz,
    p_timezone text DEFAULT 'America/Sao_Paulo'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_staff jsonb;
    v_legacy integer;
BEGIN
    PERFORM 1 FROM ap.require_editorial_admin_access(p_cliente_id);
    IF p_start IS NULL OR p_end IS NULL OR p_start >= p_end THEN
        RAISE EXCEPTION 'REPORT_RANGE_INVALID' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = p_timezone) THEN
        RAISE EXCEPTION 'REPORT_TIMEZONE_INVALID' USING ERRCODE = '22023';
    END IF;

    WITH client_context AS (
        SELECT client.id AS cliente_id, client.empresa_id,
               COALESCE(company.tenant_id, company.id) AS tenant_empresa_id
        FROM public.clientes client
        LEFT JOIN public.empresas company ON company.id = client.empresa_id
        WHERE client.id = p_cliente_id
    ), members AS (
        SELECT DISTINCT professional.id, professional.nome, professional.last_activity_at
        FROM public.profissionais professional
        CROSS JOIN client_context context
        WHERE professional.ativo IS TRUE
          AND professional.role IN ('admin', 'staff')
          AND (
              EXISTS (
                  SELECT 1 FROM public.cliente_profissionais membership
                  WHERE membership.cliente_id = p_cliente_id
                    AND membership.profissional_id = professional.id
                    AND membership.ativo IS TRUE
              )
              OR EXISTS (
                  SELECT 1 FROM public.empresa_profissionais membership
                  WHERE membership.profissional_id = professional.id
                    AND membership.ativo IS TRUE
                    AND membership.empresa_id IN (context.empresa_id, context.tenant_empresa_id)
              )
          )
    ), report_rows AS (
        SELECT member.id, member.nome,
            (SELECT count(*) FROM public.tarefas task
             WHERE task.cliente_id = p_cliente_id
               AND task.assigned_to = member.id
               AND task.deleted_at IS NULL
               AND task.status IN ('pendente', 'em_execucao', 'atrasada')) AS os_in_progress,
            (SELECT count(*) FROM public.tarefas task
             WHERE task.cliente_id = p_cliente_id
               AND task.completed_by_user_id = member.id
               AND task.status = 'concluida'
               AND task.concluida_at >= p_start AND task.concluida_at < p_end) AS os_completed,
            (SELECT count(*) FROM public.tarefas_micro micro
             JOIN public.tarefas task ON task.id = micro.tarefa_id
             WHERE task.cliente_id = p_cliente_id
               AND micro.profissional_id = member.id
               AND micro.status = 'concluida'
               AND micro.finished_at >= p_start AND micro.finished_at < p_end) AS micro_completed,
            (SELECT count(*) FROM ap.news_backlog backlog
             WHERE backlog.cliente_id = p_cliente_id
               AND backlog.adopted_by_user_id = member.id
               AND backlog.status = 'adopted') AS articles_adopted,
            (SELECT count(*)
             FROM (
                 -- Legacy backlog in production without an editorial article
                 SELECT backlog.id
                 FROM ap.news_backlog backlog
                 LEFT JOIN ap.editorial_articles article ON article.news_backlog_id = backlog.id
                 WHERE backlog.cliente_id = p_cliente_id
                   AND backlog.adopted_by_user_id = member.id
                   AND backlog.status = 'in_production'
                   AND article.id IS NULL

                 UNION ALL

                 -- R1 editorial articles in draft or editing
                 SELECT article.id
                 FROM ap.editorial_articles article
                 WHERE article.cliente_id = p_cliente_id
                   AND article.responsible_user_id = member.id
                   AND article.status IN ('draft', 'editing')
             ) in_prod) AS articles_in_production,
            (SELECT count(*)
             FROM (
                 SELECT event.id
                 FROM ap.material_production_events event
                 WHERE event.cliente_id = p_cliente_id
                   AND event.creator_user_id = member.id
                   AND event.produced_at >= p_start AND event.produced_at < p_end

                 UNION ALL

                 SELECT article.id
                 FROM ap.editorial_articles article
                 WHERE article.cliente_id = p_cliente_id
                   AND COALESCE(article.author_user_id, article.finalized_by_user_id, article.responsible_user_id) = member.id
                   AND article.first_finalized_at IS NOT NULL
                   AND article.first_finalized_at >= p_start AND article.first_finalized_at < p_end
             ) completed) AS articles_completed,
            (SELECT count(*)
             FROM (
                 SELECT event.id
                 FROM ap.material_production_events event
                 WHERE event.cliente_id = p_cliente_id
                   AND event.creator_user_id = member.id
                   AND (event.produced_at AT TIME ZONE p_timezone)::date = (now() AT TIME ZONE p_timezone)::date

                 UNION ALL

                 SELECT article.id
                 FROM ap.editorial_articles article
                 WHERE article.cliente_id = p_cliente_id
                   AND COALESCE(article.author_user_id, article.finalized_by_user_id, article.responsible_user_id) = member.id
                   AND article.first_finalized_at IS NOT NULL
                   AND (article.first_finalized_at AT TIME ZONE p_timezone)::date = (now() AT TIME ZONE p_timezone)::date
             ) today_prod) AS articles_today,
            COALESCE((
                SELECT jsonb_agg(jsonb_build_object('date', daily.day, 'count', daily.total) ORDER BY daily.day)
                FROM (
                    SELECT (prod.produced_at AT TIME ZONE p_timezone)::date AS day, count(*) AS total
                    FROM (
                        SELECT event.produced_at
                        FROM ap.material_production_events event
                        WHERE event.cliente_id = p_cliente_id
                          AND event.creator_user_id = member.id
                          AND event.produced_at >= p_start AND event.produced_at < p_end

                        UNION ALL

                        SELECT article.first_finalized_at AS produced_at
                        FROM ap.editorial_articles article
                        WHERE article.cliente_id = p_cliente_id
                          AND COALESCE(article.author_user_id, article.finalized_by_user_id, article.responsible_user_id) = member.id
                          AND article.first_finalized_at IS NOT NULL
                          AND article.first_finalized_at >= p_start AND article.first_finalized_at < p_end
                    ) prod
                    GROUP BY (prod.produced_at AT TIME ZONE p_timezone)::date
                ) daily
            ), '[]'::jsonb) AS daily_articles,
            (SELECT max(activity_at) FROM (VALUES
                (member.last_activity_at),
                ((SELECT max(task.concluida_at) FROM public.tarefas task
                  WHERE task.completed_by_user_id = member.id AND task.cliente_id = p_cliente_id)),
                ((SELECT max(event.produced_at) FROM ap.material_production_events event
                  WHERE event.creator_user_id = member.id AND event.cliente_id = p_cliente_id)),
                ((SELECT max(backlog.updated_at) FROM ap.news_backlog backlog
                  WHERE backlog.adopted_by_user_id = member.id AND backlog.cliente_id = p_cliente_id)),
                ((SELECT max(COALESCE(article.finalized_at, article.updated_at, article.first_finalized_at))
                  FROM ap.editorial_articles article
                  WHERE article.cliente_id = p_cliente_id
                    AND (article.responsible_user_id = member.id OR article.author_user_id = member.id)))
            ) AS activity(activity_at)) AS last_activity
        FROM members member
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'staff_id', row.id,
        'staff_name', row.nome,
        'os_in_progress', row.os_in_progress,
        'os_completed', row.os_completed,
        'micro_completed', row.micro_completed,
        'articles_adopted', row.articles_adopted,
        'articles_in_production', row.articles_in_production,
        'articles_completed', row.articles_completed,
        'articles_today', row.articles_today,
        'daily_articles', row.daily_articles,
        'last_activity', row.last_activity
    ) ORDER BY row.os_completed DESC, row.articles_completed DESC, row.nome), '[]'::jsonb)
    INTO v_staff FROM report_rows row;

    SELECT count(*) INTO v_legacy
    FROM public.tarefas task
    WHERE task.cliente_id = p_cliente_id
      AND task.status = 'concluida'
      AND task.concluida_at >= p_start AND task.concluida_at < p_end
      AND task.completed_by_user_id IS NULL;

    RETURN jsonb_build_object(
        'start', p_start,
        'end', p_end,
        'timezone', p_timezone,
        'legacy_unattributed_os', v_legacy,
        'staff', v_staff
    );
END;
$function$;

REVOKE ALL ON FUNCTION ap.get_staff_productivity_report(uuid, timestamptz, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION ap.get_staff_productivity_report(uuid, timestamptz, timestamptz, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. Create/Adjust ap.list_my_editorial_articles
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS ap.list_my_editorial_articles();
DROP FUNCTION IF EXISTS ap.list_my_editorial_articles(uuid);

CREATE FUNCTION ap.list_my_editorial_articles(p_cliente_id uuid DEFAULT NULL)
RETURNS TABLE (
    id uuid,
    article_id uuid,
    news_backlog_id uuid,
    status text,
    responsible_user_id uuid,
    responsible_name text,
    headline text,
    url_original text,
    observacao text,
    created_at timestamptz,
    updated_at timestamptz,
    first_finalized_at timestamptz,
    finalized_at timestamptz,
    origem_editorial text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_user_id uuid := auth.uid();
    v_cliente_id uuid;
    v_role text;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '28000';
    END IF;

    v_cliente_id := public.require_single_operational_cliente_id();

    IF p_cliente_id IS NOT NULL AND p_cliente_id <> v_cliente_id THEN
        RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
    END IF;

    SELECT p.role INTO v_role
    FROM public.profissionais p
    WHERE p.id = v_user_id AND p.ativo IS TRUE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
    END IF;

    -- Feature flag check: if editorial workflow is disabled for this tenant, return empty
    IF NOT EXISTS (
        SELECT 1
        FROM ap.editorial_feature_flags flag
        WHERE flag.cliente_id = v_cliente_id
          AND flag.editorial_workflow_v1_enabled IS TRUE
    ) THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT
        article.id AS id,
        article.id AS article_id,
        article.news_backlog_id,
        article.status,
        article.responsible_user_id,
        article.responsible_name_snapshot AS responsible_name,
        COALESCE(
            (SELECT rev.headline
             FROM ap.editorial_article_revisions rev
             WHERE rev.article_id = article.id
             ORDER BY rev.revision_number DESC
             LIMIT 1),
            backlog.titulo
        ) AS headline,
        backlog.url_original,
        backlog.observacao,
        article.created_at,
        article.updated_at,
        article.first_finalized_at,
        article.finalized_at,
        'editorial'::text AS origem_editorial
    FROM ap.editorial_articles article
    JOIN ap.news_backlog backlog ON backlog.id = article.news_backlog_id
    WHERE article.cliente_id = v_cliente_id
      AND article.responsible_user_id = v_user_id
      AND article.status <> 'abandoned'
    ORDER BY
        CASE article.status
            WHEN 'draft' THEN 0
            WHEN 'editing' THEN 1
            WHEN 'content_final' THEN 2
            ELSE 3
        END,
        article.updated_at DESC,
        article.id DESC;
END;
$function$;

REVOKE ALL ON FUNCTION ap.list_my_editorial_articles(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION ap.list_my_editorial_articles(uuid) TO authenticated;

COMMIT;
