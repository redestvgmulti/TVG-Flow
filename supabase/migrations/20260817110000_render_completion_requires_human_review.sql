-- Prospective state-machine correction only. This migration redefines the
-- completion RPC; it does not modify existing candidate_news rows.
CREATE OR REPLACE FUNCTION ap.complete_territorial_composer_render(
    p_candidate_id uuid,
    p_render_url text
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
       AND COALESCE(auth.jwt() ->> 'role', '') <> 'service_role' THEN
        RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED'
            USING ERRCODE = '42501';
    END IF;
    IF NULLIF(btrim(COALESCE(p_render_url, '')), '') IS NULL THEN
        RAISE EXCEPTION 'RENDER_URL_INVALID'
            USING ERRCODE = '22023';
    END IF;

    SELECT candidate.*
    INTO v_candidate
    FROM ap.candidate_news AS candidate
    WHERE candidate.id = p_candidate_id
    FOR UPDATE;

    IF NOT FOUND
       OR v_candidate.render_contract_version <> 'territorial_composer_v1' THEN
        RAISE EXCEPTION 'TERRITORIAL_CANDIDATE_INVALID'
            USING ERRCODE = '23514';
    END IF;
    -- Keep legacy approved/posted records idempotent while making newly
    -- completed renders wait for a human review.
    IF v_candidate.status IN ('pending_review', 'approved', 'posted') THEN
        IF v_candidate.render_url = btrim(p_render_url)
           AND (
               v_candidate.territorial_reservation_id IS NULL
               OR EXISTS (
                   SELECT 1
                   FROM ap.territorial_sponsor_reservations AS reservation
                   WHERE reservation.id = v_candidate.territorial_reservation_id
                     AND reservation.status = 'committed'
               )
           ) THEN
            RETURN jsonb_build_object(
                'candidate_news', to_jsonb(v_candidate),
                'committed', true,
                'reused', true
            );
        END IF;
        RAISE EXCEPTION 'RENDER_COMPLETION_CONFLICT'
            USING ERRCODE = '23514';
    END IF;
    IF v_candidate.status <> 'pending_render' THEN
        RAISE EXCEPTION 'RENDER_COMPLETION_INVALID_STATUS'
            USING ERRCODE = '23514';
    END IF;

    IF v_candidate.territorial_reservation_id IS NOT NULL THEN
        UPDATE ap.territorial_sponsor_reservations AS reservation
        SET status = 'committed',
            committed_at = now(),
            released_at = NULL,
            release_reason = NULL
        WHERE reservation.id = v_candidate.territorial_reservation_id
          AND reservation.status = 'reserved';

        IF NOT FOUND THEN
            RAISE EXCEPTION 'RESERVATION_NOT_RESERVED'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    UPDATE ap.candidate_news AS candidate
    SET render_url = btrim(p_render_url),
        imagem_url = btrim(p_render_url),
        status = 'pending_review',
        render_started_at = NULL,
        completed_at = now(),
        error_log = NULL
    WHERE candidate.id = p_candidate_id
    RETURNING candidate.* INTO v_candidate;

    RETURN jsonb_build_object(
        'candidate_news', to_jsonb(v_candidate),
        'committed', true
    );
END;
$function$;

COMMENT ON FUNCTION ap.complete_territorial_composer_render(uuid, text)
IS 'Completes a territorial render into pending_review; approval remains a human action.';
