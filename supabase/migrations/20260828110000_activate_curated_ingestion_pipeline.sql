-- Activate the curated ingestion head without touching candidate_news or any
-- downstream render/publish workflow. This migration is forward-only.
BEGIN;

-- Persist the article domain for admin curation and make run-level outcomes
-- explicit. Existing historical rows remain unchanged and nullable.
ALTER TABLE ap.collected_news
    ADD COLUMN IF NOT EXISTS source_domain text;

CREATE OR REPLACE FUNCTION ap.set_collected_news_derived_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
DECLARE
    v_host text;
BEGIN
    NEW.url_original := btrim(NEW.url_original);
    NEW.canonical_url := btrim(COALESCE(NULLIF(NEW.canonical_url, ''), NEW.url_original));
    NEW.normalized_url := ap.normalize_news_backlog_url(NEW.canonical_url);
    NEW.title := btrim(NEW.title);
    v_host := lower(split_part(split_part(NEW.canonical_url, '://', 2), '/', 1));
    NEW.source_domain := NULLIF(
        CASE WHEN v_host LIKE 'www.%' THEN substr(v_host, 5) ELSE v_host END,
        ''
    );
    NEW.updated_at := now();
    RETURN NEW;
END;
$function$;

-- The product navigation grants administrative access to both roles. Keep the
-- SQL policy aligned while preserving tenant scope for ordinary admins.
CREATE OR REPLACE FUNCTION ap.require_editorial_admin_access(p_cliente_id uuid)
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
      AND professional.role IN ('admin', 'super_admin')
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
        RAISE EXCEPTION 'EDITORIAL_ADMIN_REQUIRED' USING ERRCODE = '42501';
    END IF;
END;
$function$;

-- The deployed v42 code runs behind the same endpoint as the legacy worker.
-- Preserve its existing (already-valid) authenticated cron command verbatim;
-- only certify its target and normalize its intended 30-minute schedule.
DO $migration$
DECLARE
    v_command text;
    v_job_id bigint;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM vault.secrets WHERE name = 'ap_internal_worker_secret'
    ) THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: ap_internal_worker_secret is required';
    END IF;

    SELECT jobid, command
      INTO v_job_id, v_command
      FROM cron.job
     WHERE jobname = 'ap-data-ingestion'
     LIMIT 1;

    IF v_job_id IS NULL OR v_command IS NULL THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: ap-data-ingestion cron job is required';
    END IF;

    IF position('/functions/v1/ap-data-ingestion' IN v_command) = 0 THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: ap-data-ingestion cron job targets an unexpected endpoint';
    END IF;

    IF position('Authorization' IN v_command) = 0
       OR position('x-ap-internal-secret' IN v_command) = 0 THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: ap-data-ingestion cron job lacks required authenticated-worker headers';
    END IF;

    PERFORM cron.alter_job(
        job_id := v_job_id,
        schedule := '*/30 * * * *',
        active := true
    );
END;
$migration$;

NOTIFY pgrst, 'reload schema';
COMMIT;
