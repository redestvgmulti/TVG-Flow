-- Schedule only the Instagram Radar internal worker. Its internal secret is
-- resolved at runtime; no secret value is stored in the cron command.
DO $$
DECLARE
    v_command text;
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM vault.secrets
         WHERE name = 'ap_internal_worker_secret'
    ) THEN
        RAISE EXCEPTION
            'PRECONDITION_FAILED: vault secret ap_internal_worker_secret is required';
    END IF;

    -- This migration owns only this exact job name. Replacing it prevents a
    -- duplicate schedule without affecting any other cron job.
    PERFORM cron.unschedule(jobid)
      FROM cron.job
     WHERE jobname = 'ap-instagram-radar-ingestion';

    v_command := $cron$
SELECT net.http_post(
    url := 'https://gyooxmpyxncrezjiljrj.supabase.co/functions/v1/ap-instagram-radar-ingestion',
    headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-ap-internal-secret', (
            SELECT decrypted_secret
              FROM vault.decrypted_secrets
             WHERE name = 'ap_internal_worker_secret'
             ORDER BY created_at DESC
             LIMIT 1
        )
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
)
$cron$;

    PERFORM cron.schedule(
        'ap-instagram-radar-ingestion',
        '*/20 * * * *',
        v_command
    );
END;
$$;
