-- Acquire one content-production candidate with a single database CAS.
-- The fixed ten-minute TTL preserves the existing worker recovery policy.
CREATE OR REPLACE FUNCTION ap.acquire_content_production_lock(
    p_candidate_id uuid,
    p_expected_cliente_id uuid,
    p_expected_status text,
    p_expected_processing_started_at timestamptz,
    p_expected_worker_id uuid,
    p_worker_id uuid
)
RETURNS TABLE (
    id uuid,
    processing_started_at timestamptz,
    worker_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, ap
AS $function$
DECLARE
    v_lock_time timestamptz := clock_timestamp();
BEGIN
    IF session_user <> 'postgres'
       AND COALESCE(auth.jwt() ->> 'role', '') <> 'service_role' THEN
        RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED'
            USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    UPDATE ap.candidate_news AS candidate
    SET processing_started_at = v_lock_time,
        worker_id = p_worker_id
    WHERE candidate.id = p_candidate_id
      AND candidate.cliente_id = p_expected_cliente_id
      AND candidate.status = 'selected'
      AND candidate.status = p_expected_status
      AND candidate.processing_started_at IS NOT DISTINCT FROM
          p_expected_processing_started_at
      AND candidate.worker_id IS NOT DISTINCT FROM p_expected_worker_id
      AND (
          candidate.processing_started_at IS NULL
          OR candidate.processing_started_at < v_lock_time - interval '10 minutes'
      )
    RETURNING
        candidate.id,
        candidate.processing_started_at,
        candidate.worker_id;
END;
$function$;

REVOKE ALL ON FUNCTION ap.acquire_content_production_lock(
    uuid, uuid, text, timestamptz, uuid, uuid
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION ap.acquire_content_production_lock(
    uuid, uuid, text, timestamptz, uuid, uuid
) TO service_role;

COMMENT ON FUNCTION ap.acquire_content_production_lock(
    uuid, uuid, text, timestamptz, uuid, uuid
) IS 'Atomically acquires an eligible selected candidate for ap-content-production using the observed tenant and lock state.';
