-- Phase 0: make AutoPublisher worker invocation fail closed and restore the
-- existing ap.worker_telemetry sink. This migration changes no editorial row,
-- historical state, template, source, or stored object.

REVOKE ALL ON TABLE ap.worker_telemetry FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE ap.worker_telemetry TO service_role;

DO $$
DECLARE
    v_reference_command text;
    v_reference_url text;
    v_anon_token text;
    v_job record;
    v_target_url text;
    v_command text;
    v_image_job_id bigint;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM vault.secrets WHERE name = 'ap_internal_worker_secret'
    ) THEN
        RAISE EXCEPTION
            'PRECONDITION_FAILED: vault secret ap_internal_worker_secret is required';
    END IF;

    SELECT command
      INTO v_reference_command
      FROM cron.job
     WHERE jobname = 'ap-render-engine'
       AND active = true
     LIMIT 1;

    IF v_reference_command IS NULL THEN
        RAISE EXCEPTION
            'PRECONDITION_FAILED: active ap-render-engine cron job was not found';
    END IF;

    v_reference_url := substring(v_reference_command FROM 'url\s*:=\s*''([^'']+)''');
    v_anon_token := substring(v_reference_command FROM 'Authorization[^B]*Bearer ([^"'']+)');
    IF v_reference_url IS NULL OR v_anon_token IS NULL THEN
        RAISE EXCEPTION
            'PRECONDITION_FAILED: ap-render-engine cron command has an unknown shape';
    END IF;

    FOR v_job IN
        SELECT jobid, jobname
          FROM cron.job
         WHERE jobname IN (
             'ap-data-ingestion',
             'ap-scoring-engine',
             'ap-daily-feed-builder',
             'ap-render-engine',
             'ap-render-recovery'
         )
    LOOP
        v_target_url := regexp_replace(
            v_reference_url,
            '/functions/v1/[^/?]+.*$',
            '/functions/v1/' || v_job.jobname
        );
        v_command := format(
            $cron$
SELECT net.http_post(
    url := %L,
    headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || %L,
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
            v_target_url,
            v_anon_token
        );
        PERFORM cron.alter_job(job_id := v_job.jobid, command := v_command);
    END LOOP;

    IF (
        SELECT count(*)
          FROM cron.job
         WHERE jobname IN (
             'ap-data-ingestion',
             'ap-scoring-engine',
             'ap-daily-feed-builder',
             'ap-render-engine',
             'ap-render-recovery'
         )
    ) <> 5 THEN
        RAISE EXCEPTION
            'PRECONDITION_FAILED: one or more required AutoPublisher cron jobs are missing';
    END IF;

    v_target_url := regexp_replace(
        v_reference_url,
        '/functions/v1/[^/?]+.*$',
        '/functions/v1/ap-image-fetcher'
    );
    v_command := format(
        $cron$
SELECT net.http_post(
    url := %L,
    headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || %L,
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
        v_target_url,
        v_anon_token
    );

    SELECT jobid INTO v_image_job_id
      FROM cron.job
     WHERE jobname = 'ap-image-fetcher'
     LIMIT 1;

    IF v_image_job_id IS NULL THEN
        PERFORM cron.schedule(
            'ap-image-fetcher',
            '*/5 * * * *',
            v_command
        );
    ELSE
        PERFORM cron.alter_job(
            job_id := v_image_job_id,
            schedule := '*/5 * * * *',
            command := v_command,
            active := true
        );
    END IF;
END;
$$;

-- Logical rollback: redeploy the previous function versions, restore the
-- previous cron commands, unschedule ap-image-fetcher, and revoke the three
-- service_role grants. No domain data rollback is required.
