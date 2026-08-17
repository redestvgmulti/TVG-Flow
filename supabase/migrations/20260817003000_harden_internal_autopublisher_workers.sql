-- Phase 0.1: add an explicit internal credential to the existing content
-- worker cron call. No domain data, candidate_news rows, or status values are
-- touched. The Edge Function must receive the same secret as
-- AP_INTERNAL_WORKER_SECRET before its hardened version is deployed.
DO $$
DECLARE
    v_job_id bigint;
    v_command text;
    v_url text;
    v_anon_token text;
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM vault.secrets
        WHERE name = 'ap_internal_worker_secret'
    ) THEN
        RAISE EXCEPTION
            'PRECONDITION_FAILED: vault secret ap_internal_worker_secret must exist before this migration';
    END IF;

    SELECT jobid, command
      INTO v_job_id, v_command
      FROM cron.job
     WHERE jobname = 'ap-content-production'
     LIMIT 1;

    IF v_job_id IS NULL OR v_command IS NULL THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: ap-content-production cron job was not found';
    END IF;

    IF position('x-ap-internal-secret' in v_command) > 0 THEN
        RETURN;
    END IF;

    v_url := substring(v_command FROM 'url\s*:=\s*''([^'']+)''');
    v_anon_token := substring(v_command FROM 'Authorization[^B]*Bearer ([^"'']+)');
    IF v_url IS NULL OR v_anon_token IS NULL THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: existing content-production cron command has an unknown shape';
    END IF;

    PERFORM cron.alter_job(
        job_id := v_job_id,
        command := format(
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
            v_url,
            v_anon_token
        )
    );
END;
$$;
