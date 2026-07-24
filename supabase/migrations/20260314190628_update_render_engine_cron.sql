DO $migration$
DECLARE
    v_job_id bigint;
BEGIN
    SELECT jobid
    INTO v_job_id
    FROM cron.job
    WHERE command ILIKE '%ap-render-engine%'
    ORDER BY jobid
    LIMIT 1;

    IF v_job_id IS NOT NULL THEN
        PERFORM cron.alter_job(
            job_id := v_job_id,
            schedule := '*/1 * * * *'
        );
    ELSE
        RAISE NOTICE
            'ap-render-engine cron job not found; schedule update skipped.';
    END IF;
END;
$migration$;