SELECT cron.alter_job(
    job_id := (SELECT jobid FROM cron.job WHERE command ILIKE '%ap-render-engine%' LIMIT 1),
    schedule := '*/1 * * * *'
);
