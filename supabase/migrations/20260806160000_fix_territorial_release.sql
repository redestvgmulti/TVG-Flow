-- Fix ap.release_territorial_composer_candidate to be fully idempotent

CREATE OR REPLACE FUNCTION ap.release_territorial_composer_candidate(
    p_candidate_id uuid,
    p_reason text DEFAULT 'generation_failed'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, ap
AS $function$
DECLARE
    v_candidate ap.candidate_news%ROWTYPE;
BEGIN
    IF session_user <> 'postgres'
       AND COALESCE(
           current_setting('request.jwt.claim.role', true),
           ''
       ) <> 'service_role' THEN
        RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED'
            USING ERRCODE = '42501';
    END IF;

    IF p_candidate_id IS NULL THEN
        RETURN jsonb_build_object(
            'candidate_id', NULL,
            'reservation_id', NULL,
            'released', true
        );
    END IF;

    SELECT candidate.*
    INTO v_candidate
    FROM ap.candidate_news AS candidate
    WHERE candidate.id = p_candidate_id
    FOR UPDATE;

    IF NOT FOUND THEN
        -- Candidate was not created, so no reservation exists. Success.
        RETURN jsonb_build_object(
            'candidate_id', p_candidate_id,
            'reservation_id', NULL,
            'released', true
        );
    END IF;

    IF v_candidate.render_contract_version <> 'territorial_composer_v1' THEN
        RAISE EXCEPTION 'TERRITORIAL_CANDIDATE_INVALID'
            USING ERRCODE = '23514';
    END IF;

    IF v_candidate.territorial_reservation_id IS NOT NULL THEN
        UPDATE ap.territorial_sponsor_reservations AS reservation
        SET status = 'released',
            committed_at = NULL,
            released_at = now(),
            release_reason = left(
                COALESCE(NULLIF(btrim(p_reason), ''), 'generation_failed'),
                120
            )
        WHERE reservation.id = v_candidate.territorial_reservation_id
          AND reservation.status = 'reserved';
    END IF;

    UPDATE ap.candidate_news AS candidate
    SET processing_started_at = NULL
    WHERE candidate.id = p_candidate_id
      AND candidate.status = 'processing';

    RETURN jsonb_build_object(
        'candidate_id', p_candidate_id,
        'reservation_id', v_candidate.territorial_reservation_id,
        'released', true
    );
END;
$function$;
