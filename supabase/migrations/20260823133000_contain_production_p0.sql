-- Production P0 containment (2026-08-23).
-- Scope: exposed internal tables, SECURITY DEFINER grants/identity checks,
-- internal Edge callers, and tenant-safe permission helpers.
-- This migration changes no domain or historical row.

BEGIN;

SET LOCAL search_path = pg_catalog, public, ap, extensions;

DO $$
DECLARE
    v_missing text[];
BEGIN
    SELECT array_agg(expected.object_name ORDER BY expected.object_name)
      INTO v_missing
      FROM (
          VALUES
              ('public.backup_empresa_profissionais'),
              ('public.backup_tarefas_micro'),
              ('public.empresa_profissionais_backup_2026_01_12'),
              ('public.tarefas_backup_20260112'),
              ('public.notification_queue'),
              ('public.overdue_notifications_log'),
              ('ap.template_queue_state')
      ) AS expected(object_name)
     WHERE to_regclass(expected.object_name) IS NULL;

    IF v_missing IS NOT NULL THEN
        RAISE EXCEPTION 'P0_PRECONDITION_FAILED: missing tables: %', v_missing;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM vault.secrets WHERE name = 'ap_internal_worker_secret'
    ) THEN
        RAISE EXCEPTION
            'P0_PRECONDITION_FAILED: vault secret ap_internal_worker_secret is required';
    END IF;
END;
$$;

-- Internal state and historical backup tables are not client-facing APIs.
ALTER TABLE public.backup_empresa_profissionais ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.backup_tarefas_micro ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.empresa_profissionais_backup_2026_01_12 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tarefas_backup_20260112 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.overdue_notifications_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE ap.template_queue_state ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.backup_empresa_profissionais FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.backup_tarefas_micro FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.empresa_profissionais_backup_2026_01_12 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.tarefas_backup_20260112 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.notification_queue FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.overdue_notifications_log FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE ap.template_queue_state FROM PUBLIC, anon, authenticated;

GRANT ALL ON TABLE public.backup_empresa_profissionais TO service_role;
GRANT ALL ON TABLE public.backup_tarefas_micro TO service_role;
GRANT ALL ON TABLE public.empresa_profissionais_backup_2026_01_12 TO service_role;
GRANT ALL ON TABLE public.tarefas_backup_20260112 TO service_role;
GRANT ALL ON TABLE public.notification_queue TO service_role;
GRANT ALL ON TABLE public.overdue_notifications_log TO service_role;
GRANT ALL ON TABLE ap.template_queue_state TO service_role;

-- SECURITY DEFINER is default-deny for anonymous callers. Trigger functions
-- are never directly executable by API roles. Existing authenticated grants
-- are preserved unless the routine is explicitly classified below.
DO $$
DECLARE
    v_function record;
    v_signature text;
BEGIN
    FOR v_function IN
        SELECT p.oid,
               n.nspname,
               p.proname,
               p.prorettype,
               p.oid::regprocedure::text AS regprocedure
          FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE p.prosecdef
           AND p.prokind = 'f'
           AND n.nspname IN ('public', 'ap')
    LOOP
        v_signature := v_function.regprocedure;
        EXECUTE format(
            'REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon',
            v_signature
        );

        IF v_function.prorettype = 'trigger'::regtype THEN
            EXECUTE format(
                'REVOKE ALL ON FUNCTION %s FROM authenticated, service_role',
                v_signature
            );
        END IF;

        IF v_function.nspname = 'ap' THEN
            EXECUTE format(
                'ALTER FUNCTION %s SET search_path = pg_catalog, ap, public, extensions',
                v_signature
            );
        ELSE
            EXECUTE format(
                'ALTER FUNCTION %s SET search_path = pg_catalog, public, ap, extensions',
                v_signature
            );
        END IF;
    END LOOP;
END;
$$;

-- Internal/admin/legacy routines: never client-executable. Calls from other
-- SECURITY DEFINER functions continue as their owner; Edge workers use the
-- service role explicitly.
DO $$
DECLARE
    v_function record;
BEGIN
    FOR v_function IN
        SELECT p.oid::regprocedure::text AS regprocedure
          FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE p.prosecdef
           AND p.prokind = 'f'
           AND (
               (
                   n.nspname = 'ap'
                   AND p.proname IN (
                       'get_and_advance_template',
                       'get_next_template',
                       'match_editorial_documents',
                       'refund_editorial_tokens',
                       'reserve_editorial_tokens',
                       'select_sponsor',
                       'create_candidate_with_sponsors'
                   )
               )
               OR
               (
                   n.nspname = 'public'
                   AND p.proname IN (
                       'auto_close_meetings',
                       'archive_feed_post',
                       'bulk_create_deadline_notifications',
                       'can_add_micro_tasks',
                       'can_change_deadline',
                       'can_convert_to_complex',
                       'can_delete_os',
                       'cleanup_old_notifications',
                       'create_feed_post',
                       'create_os_with_micro_tasks',
                       'debug_whoami',
                       'get_and_advance_template',
                       'get_dashboard_data',
                       'get_decrypted_secret',
                       'get_upcoming_deadline_notifications',
                       'get_user_emails_for_ap',
                       'insert_secret',
                       'mark_all_notifications_as_read',
                       'notify_admins_and_managers',
                       'process_notification_queue',
                       'publish_feed_post',
                       'rpc_abrir_solicitacao',
                       'rpc_adicionar_anexo',
                       'rpc_adicionar_comentario',
                       'rpc_atualizar_status_solicitacao',
                       'sweep_progress_inconsistencies',
                       'update_os'
                   )
               )
           )
    LOOP
        EXECUTE format(
            'REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated',
            v_function.regprocedure
        );
        EXECUTE format(
            'GRANT EXECUTE ON FUNCTION %s TO service_role',
            v_function.regprocedure
        );
    END LOOP;
END;
$$;

-- Permission helpers are callable only by the service-backed Edge functions
-- and by their owner when nested in a trusted RPC. They derive authorization
-- from the supplied session user only after checking an active tenant link.
CREATE OR REPLACE FUNCTION public.can_change_deadline(
    p_os_id uuid,
    p_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_os record;
    v_role text;
BEGIN
    IF p_user_id IS NULL THEN
        RETURN false;
    END IF;

    SELECT t.status, t.created_by, t.deleted_at, t.empresa_id
      INTO v_os
      FROM public.tarefas t
     WHERE t.id = p_os_id;

    IF v_os IS NULL OR v_os.deleted_at IS NOT NULL THEN
        RETURN false;
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.empresa_profissionais ep
         WHERE ep.profissional_id = p_user_id
           AND ep.empresa_id = v_os.empresa_id
           AND ep.ativo = true
    ) THEN
        RETURN false;
    END IF;

    SELECT p.role INTO v_role
      FROM public.profissionais p
     WHERE p.id = p_user_id
       AND p.ativo = true;

    RETURN v_role = 'admin'
        OR (v_os.created_by = p_user_id AND v_os.status = 'pendente');
END;
$$;

CREATE OR REPLACE FUNCTION public.can_convert_to_complex(
    p_os_id uuid,
    p_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_os record;
BEGIN
    SELECT t.status, t.has_micro_tasks, t.deleted_at, t.empresa_id
      INTO v_os
      FROM public.tarefas t
     WHERE t.id = p_os_id;

    RETURN p_user_id IS NOT NULL
       AND v_os IS NOT NULL
       AND v_os.deleted_at IS NULL
       AND v_os.status NOT IN ('concluida', 'cancelada')
       AND v_os.has_micro_tasks = false
       AND EXISTS (
           SELECT 1
             FROM public.profissionais p
             JOIN public.empresa_profissionais ep
               ON ep.profissional_id = p.id
            WHERE p.id = p_user_id
              AND p.ativo = true
              AND p.role = 'admin'
              AND ep.empresa_id = v_os.empresa_id
              AND ep.ativo = true
       );
END;
$$;

CREATE OR REPLACE FUNCTION public.can_add_micro_tasks(
    p_os_id uuid,
    p_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_os record;
BEGIN
    SELECT t.status, t.has_micro_tasks, t.deleted_at, t.empresa_id
      INTO v_os
      FROM public.tarefas t
     WHERE t.id = p_os_id;

    RETURN p_user_id IS NOT NULL
       AND v_os IS NOT NULL
       AND v_os.deleted_at IS NULL
       AND v_os.status NOT IN ('concluida', 'cancelada')
       AND v_os.has_micro_tasks = true
       AND EXISTS (
           SELECT 1
             FROM public.profissionais p
             JOIN public.empresa_profissionais ep
               ON ep.profissional_id = p.id
            WHERE p.id = p_user_id
              AND p.ativo = true
              AND p.role = 'admin'
              AND ep.empresa_id = v_os.empresa_id
              AND ep.ativo = true
       );
END;
$$;

CREATE OR REPLACE FUNCTION public.can_delete_os(
    p_os_id uuid,
    p_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_os record;
    v_role text;
    v_event_count integer;
BEGIN
    IF p_user_id IS NULL THEN
        RETURN false;
    END IF;

    SELECT t.status, t.created_by, t.deleted_at, t.empresa_id
      INTO v_os
      FROM public.tarefas t
     WHERE t.id = p_os_id;

    IF v_os IS NULL OR v_os.deleted_at IS NOT NULL THEN
        RETURN false;
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.empresa_profissionais ep
         WHERE ep.profissional_id = p_user_id
           AND ep.empresa_id = v_os.empresa_id
           AND ep.ativo = true
    ) THEN
        RETURN false;
    END IF;

    SELECT p.role INTO v_role
      FROM public.profissionais p
     WHERE p.id = p_user_id
       AND p.ativo = true;

    IF v_role = 'admin' THEN
        RETURN true;
    END IF;

    IF v_os.created_by <> p_user_id OR v_os.status <> 'pendente' THEN
        RETURN false;
    END IF;

    SELECT count(*) INTO v_event_count
      FROM public.os_eventos oe
     WHERE oe.os_id = p_os_id
       AND oe.tipo <> 'os_criada';

    RETURN v_event_count = 0;
END;
$$;

REVOKE ALL ON FUNCTION public.can_change_deadline(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.can_convert_to_complex(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.can_add_micro_tasks(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.can_delete_os(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.can_change_deadline(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.can_convert_to_complex(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.can_add_micro_tasks(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.can_delete_os(uuid, uuid) TO service_role;

-- Super-admin RPCs keep their existing contract, but the public signature is
-- now an authenticated authorization wrapper. The previous implementation is
-- retained under a non-executable internal name for rollback.
ALTER FUNCTION public.get_tenant_details(uuid)
    RENAME TO get_tenant_details_p0_internal;
REVOKE ALL ON FUNCTION public.get_tenant_details_p0_internal(uuid)
    FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.get_tenant_details(target_company_id uuid)
RETURNS TABLE(
    id uuid,
    nome text,
    cnpj text,
    status_conta text,
    internal_notes text,
    created_at timestamptz,
    admins_count bigint,
    staff_count bigint,
    admins_list json,
    health_status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
    IF auth.role() <> 'service_role'
       AND NOT EXISTS (
           SELECT 1
             FROM public.profissionais p
            WHERE p.id = auth.uid()
              AND p.role = 'super_admin'
              AND p.ativo = true
       ) THEN
        RAISE EXCEPTION 'FORBIDDEN: active super_admin required'
            USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT *
      FROM public.get_tenant_details_p0_internal(target_company_id);
END;
$$;

REVOKE ALL ON FUNCTION public.get_tenant_details(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_tenant_details(uuid) TO authenticated, service_role;

ALTER FUNCTION public.get_companies_stats()
    RENAME TO get_companies_stats_p0_internal;
REVOKE ALL ON FUNCTION public.get_companies_stats_p0_internal()
    FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.get_companies_stats()
RETURNS TABLE(
    id uuid,
    nome text,
    status_conta text,
    icp_status text,
    tipo_negocio text,
    users_count bigint,
    active_tasks_count bigint,
    created_at timestamptz,
    last_activity_at timestamptz,
    health_status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
    IF auth.role() <> 'service_role'
       AND NOT EXISTS (
           SELECT 1
             FROM public.profissionais p
            WHERE p.id = auth.uid()
              AND p.role = 'super_admin'
              AND p.ativo = true
       ) THEN
        RAISE EXCEPTION 'FORBIDDEN: active super_admin required'
            USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT * FROM public.get_companies_stats_p0_internal();
END;
$$;

REVOKE ALL ON FUNCTION public.get_companies_stats() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_companies_stats() TO authenticated, service_role;

-- Tenant-scoped operational metrics.
CREATE OR REPLACE FUNCTION public.count_unassigned_tasks()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
    SELECT count(*)::integer
      FROM public.tarefas t
     WHERE t.status NOT IN ('concluida', 'cancelada')
       AND EXISTS (
           SELECT 1
             FROM public.empresa_profissionais ep
            WHERE ep.profissional_id = auth.uid()
              AND ep.empresa_id = t.empresa_id
              AND ep.ativo = true
       )
       AND NOT EXISTS (
           SELECT 1
             FROM public.tarefas_micro tm
            WHERE tm.tarefa_id = t.id
              AND tm.profissional_id IS NOT NULL
       );
$$;

CREATE OR REPLACE FUNCTION public.get_dashboard_chart_data(days_back integer DEFAULT 30)
RETURNS TABLE(date text, criadas bigint, concluidas bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
    IF auth.uid() IS NULL OR days_back NOT BETWEEN 1 AND 365 THEN
        RAISE EXCEPTION 'INVALID_OR_UNAUTHENTICATED_REQUEST'
            USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    WITH date_series AS (
        SELECT generate_series(
            current_date - (days_back - 1),
            current_date,
            '1 day'::interval
        )::date AS day
    ),
    task_stats AS (
        SELECT t.created_at::date AS created_date,
               t.completed_at::date AS completed_date
          FROM public.tarefas t
         WHERE t.created_at >= current_date - days_back
           AND t.status <> 'cancelada'
           AND EXISTS (
               SELECT 1
                 FROM public.empresa_profissionais ep
                WHERE ep.profissional_id = auth.uid()
                  AND ep.empresa_id = t.empresa_id
                  AND ep.ativo = true
           )
    )
    SELECT to_char(ds.day, 'DD/MM'),
           count(ts.created_date) FILTER (WHERE ts.created_date = ds.day),
           count(ts.completed_date) FILTER (WHERE ts.completed_date = ds.day)
      FROM date_series ds
      LEFT JOIN task_stats ts ON true
     GROUP BY ds.day
     ORDER BY ds.day;
END;
$$;

REVOKE ALL ON FUNCTION public.count_unassigned_tasks() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_dashboard_chart_data(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.count_unassigned_tasks() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_dashboard_chart_data(integer) TO authenticated;

-- Identity-bearing meeting operations are wrapped so a client cannot claim a
-- different participant or notify users for a meeting it does not control.
ALTER FUNCTION public.notify_meeting_presence(uuid, uuid)
    RENAME TO notify_meeting_presence_p0_internal;
REVOKE ALL ON FUNCTION public.notify_meeting_presence_p0_internal(uuid, uuid)
    FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.notify_meeting_presence(
    p_reuniao_id uuid,
    p_participante_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
    IF auth.role() <> 'service_role' THEN
        IF auth.uid() IS NULL OR auth.uid() <> p_participante_id THEN
            RAISE EXCEPTION 'FORBIDDEN: participant must match session identity'
                USING ERRCODE = '42501';
        END IF;

        IF NOT EXISTS (
            SELECT 1
              FROM public.reunioes_participantes rp
             WHERE rp.reuniao_id = p_reuniao_id
               AND rp.profissional_id = auth.uid()
        ) THEN
            RAISE EXCEPTION 'FORBIDDEN: meeting participant required'
                USING ERRCODE = '42501';
        END IF;
    END IF;

    RETURN public.notify_meeting_presence_p0_internal(
        p_reuniao_id,
        p_participante_id
    );
END;
$$;

ALTER FUNCTION public.create_meeting_notification(uuid, uuid, text, timestamptz, integer)
    RENAME TO create_meeting_notification_p0_internal;
REVOKE ALL ON FUNCTION public.create_meeting_notification_p0_internal(uuid, uuid, text, timestamptz, integer)
    FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.create_meeting_notification(
    p_reuniao_id uuid,
    p_profissional_id uuid,
    p_titulo text,
    p_data_inicio timestamptz,
    p_interval_minutes integer
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
    IF auth.role() <> 'service_role' THEN
        IF auth.uid() IS NULL OR NOT EXISTS (
            SELECT 1
              FROM public.reunioes r
             WHERE r.id = p_reuniao_id
               AND (
                   r.criada_por = auth.uid()
                   OR EXISTS (
                       SELECT 1
                         FROM public.profissionais p
                         JOIN public.empresa_profissionais ep
                           ON ep.profissional_id = p.id
                        WHERE p.id = auth.uid()
                          AND p.role = 'admin'
                          AND p.ativo = true
                          AND ep.empresa_id = r.empresa_id
                          AND ep.ativo = true
                   )
               )
        ) THEN
            RAISE EXCEPTION 'FORBIDDEN: meeting creator or tenant admin required'
                USING ERRCODE = '42501';
        END IF;

        IF NOT EXISTS (
            SELECT 1
              FROM public.reunioes_participantes rp
             WHERE rp.reuniao_id = p_reuniao_id
               AND rp.profissional_id = p_profissional_id
        ) THEN
            RAISE EXCEPTION 'FORBIDDEN: notification target is not a participant'
                USING ERRCODE = '42501';
        END IF;
    END IF;

    RETURN public.create_meeting_notification_p0_internal(
        p_reuniao_id,
        p_profissional_id,
        p_titulo,
        p_data_inicio,
        p_interval_minutes
    );
END;
$$;

REVOKE ALL ON FUNCTION public.notify_meeting_presence(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_meeting_notification(uuid, uuid, text, timestamptz, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notify_meeting_presence(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_meeting_notification(uuid, uuid, text, timestamptz, integer) TO authenticated, service_role;

-- Keep the existing super-admin implementation, but tighten the grant and
-- search path. Its body already verifies auth.uid() against the source table.
REVOKE ALL ON FUNCTION public.get_super_admin_dashboard_stats() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_super_admin_dashboard_stats() TO authenticated, service_role;
ALTER FUNCTION public.get_super_admin_dashboard_stats()
    SET search_path = pg_catalog, public;

-- Authenticate the three non-JWT operational callers with the existing
-- fail-closed internal worker secret. No secret value is embedded in schema.
DO $$
DECLARE
    v_reference_command text;
    v_reference_url text;
    v_job record;
    v_target_url text;
    v_command text;
BEGIN
    SELECT command
      INTO v_reference_command
      FROM cron.job
     WHERE jobname = 'ap-render-engine'
       AND active = true
     LIMIT 1;

    IF v_reference_command IS NULL THEN
        RAISE EXCEPTION
            'P0_PRECONDITION_FAILED: active ap-render-engine reference job missing';
    END IF;

    v_reference_url := substring(v_reference_command FROM 'url\s*:=\s*''([^'']+)''');

    IF v_reference_url IS NULL THEN
        RAISE EXCEPTION
            'P0_PRECONDITION_FAILED: reference cron command has unknown shape';
    END IF;

    FOR v_job IN
        SELECT jobid, jobname
          FROM cron.job
         WHERE jobname IN (
             'notify-overdue-tasks-hourly',
             'meeting-reminders-cron'
         )
    LOOP
        v_target_url := regexp_replace(
            v_reference_url,
            '/functions/v1/[^/?]+.*$',
            CASE v_job.jobname
                WHEN 'notify-overdue-tasks-hourly' THEN '/functions/v1/notify-overdue-tasks'
                ELSE '/functions/v1/meeting-reminders'
            END
        );

        v_command := format(
            $cron$
SELECT net.http_post(
    url := %L,
    headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-ap-internal-secret', (
            SELECT decrypted_secret
              FROM vault.decrypted_secrets
             WHERE name = 'ap_internal_worker_secret'
             ORDER BY created_at DESC
             LIMIT 1
        )
    )
)
$cron$,
            v_target_url
        );

        PERFORM cron.alter_job(job_id := v_job.jobid, command := v_command);
    END LOOP;

    IF (
        SELECT count(*)
          FROM cron.job
         WHERE jobname IN (
             'notify-overdue-tasks-hourly',
             'meeting-reminders-cron'
         )
    ) <> 2 THEN
        RAISE EXCEPTION
            'P0_PRECONDITION_FAILED: required notification cron jobs missing';
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.trigger_send_push_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, vault
AS $$
DECLARE
    v_request_id bigint;
BEGIN
    SELECT net.http_post(
        url := 'https://gyooxmpyxncrezjiljrj.supabase.co/functions/v1/send-push-notification',
        body := jsonb_build_object('notificationId', NEW.id),
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-ap-internal-secret', (
                SELECT decrypted_secret
                  FROM vault.decrypted_secrets
                 WHERE name = 'ap_internal_worker_secret'
                 ORDER BY created_at DESC
                 LIMIT 1
            )
        )
    ) INTO v_request_id;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trigger_send_push_notification()
    FROM PUBLIC, anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- Rollback (logical, no data restore):
-- 1. Revoke the wrapper signatures, drop them, and rename each *_p0_internal
--    routine to its original name.
-- 2. Restore the previous table grants/RLS flags and routine grants from the
--    Step 0 inventory only if a rollback is explicitly approved.
-- 3. Restore the previous cron commands and push trigger definition from the
--    production baseline, then redeploy the previous Edge versions.
