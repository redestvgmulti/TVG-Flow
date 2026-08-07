-- Fix JWT role validation in territorial composer RPCs
-- In some environments (like Deno Edge Functions using supabase-js without specific auth options),
-- request.jwt.claim.role might not be exposed as a direct scalar claim, causing the fallback to fail.
-- This replaces current_setting('request.jwt.claim.role', true) with auth.jwt() ->> 'role'
-- which robustly parses the full claims JSON payload.

CREATE OR REPLACE FUNCTION ap.finalize_territorial_composer_candidate(
    p_candidate_id uuid,
    p_headline text,
    p_caption text,
    p_context_tag text,
    p_roteiro_json jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, ap
AS $function$
DECLARE
    v_candidate ap.candidate_news%ROWTYPE;
    v_render_content jsonb;
    v_source_image_url text;
BEGIN
    IF session_user <> 'postgres'
       AND COALESCE(auth.jwt() ->> 'role', '') <> 'service_role' THEN
        RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED'
            USING ERRCODE = '42501';
    END IF;
    IF NULLIF(btrim(COALESCE(p_headline, '')), '') IS NULL THEN
        RAISE EXCEPTION 'HEADLINE_REQUIRED'
            USING ERRCODE = '22023';
    END IF;

    SELECT candidate.*
    INTO v_candidate
    FROM ap.candidate_news AS candidate
    WHERE candidate.id = p_candidate_id
    FOR UPDATE;

    IF NOT FOUND
       OR v_candidate.render_contract_version <> 'territorial_composer_v1'
       OR v_candidate.status <> 'processing'
       OR jsonb_typeof(v_candidate.render_snapshot) <> 'object' THEN
        RAISE EXCEPTION 'TERRITORIAL_CANDIDATE_FINALIZE_INVALID'
            USING ERRCODE = '23514';
    END IF;

    v_source_image_url :=
        NULLIF(btrim(COALESCE(v_candidate.imagem_url, '')), '');
    IF v_candidate.render_snapshot -> 'layer_map' ? 'news_image'
       AND (
           v_source_image_url IS NULL
           OR v_source_image_url !~* '^https?://'
       ) THEN
        RAISE EXCEPTION 'SOURCE_IMAGE_REQUIRED'
            USING ERRCODE = '23514';
    END IF;

    v_render_content := jsonb_strip_nulls(
        jsonb_build_object(
            'headline', btrim(p_headline),
            'context_tag',
                upper(btrim(COALESCE(p_context_tag, 'DESTAQUE'))),
            'source_image_url', v_source_image_url,
            'frozen_at', now()
        )
    );

    UPDATE ap.candidate_news AS candidate
    SET status = 'pending_render',
        headline = btrim(p_headline),
        caption = COALESCE(p_caption, ''),
        context_tag =
            upper(btrim(COALESCE(p_context_tag, 'DESTAQUE'))),
        roteiro_json = p_roteiro_json,
        render_snapshot = jsonb_set(
            candidate.render_snapshot,
            '{render_content}',
            v_render_content,
            true
        ),
        processing_started_at = NULL
    WHERE candidate.id = p_candidate_id
    RETURNING candidate.* INTO v_candidate;

    RETURN jsonb_build_object(
        'candidate_news', to_jsonb(v_candidate),
        'finalized', true
    );
END;
$function$;

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
       AND COALESCE(auth.jwt() ->> 'role', '') <> 'service_role' THEN
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
    IF v_candidate.status IN ('approved', 'posted') THEN
        IF v_candidate.render_url = btrim(p_render_url)
           AND (
               v_candidate.territorial_reservation_id IS NULL
               OR EXISTS (
                   SELECT 1
                   FROM ap.territorial_sponsor_reservations AS reservation
                   WHERE reservation.id =
                       v_candidate.territorial_reservation_id
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
        status = 'approved',
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

CREATE OR REPLACE FUNCTION ap.fail_territorial_composer_render(
    p_candidate_id uuid,
    p_error_code text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, ap
AS $function$
DECLARE
    v_candidate ap.candidate_news%ROWTYPE;
    v_error_code text := left(
        COALESCE(NULLIF(btrim(p_error_code), ''), 'RENDER_FAILED'),
        120
    );
BEGIN
    IF session_user <> 'postgres'
       AND COALESCE(auth.jwt() ->> 'role', '') <> 'service_role' THEN
        RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED'
            USING ERRCODE = '42501';
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
    IF v_candidate.status IN ('approved', 'posted') THEN
        RETURN jsonb_build_object(
            'candidate_news', to_jsonb(v_candidate),
            'released', false,
            'ignored_after_success', true
        );
    END IF;
    IF v_candidate.status = 'failed' THEN
        RETURN jsonb_build_object(
            'candidate_news', to_jsonb(v_candidate),
            'released', true,
            'reused', true
        );
    END IF;
    IF v_candidate.status <> 'pending_render' THEN
        RAISE EXCEPTION 'RENDER_FAILURE_INVALID_STATUS'
            USING ERRCODE = '23514';
    END IF;

    IF v_candidate.territorial_reservation_id IS NOT NULL THEN
        UPDATE ap.territorial_sponsor_reservations AS reservation
        SET status = 'released',
            committed_at = NULL,
            released_at = now(),
            release_reason = v_error_code
        WHERE reservation.id = v_candidate.territorial_reservation_id
          AND reservation.status = 'reserved';
    END IF;

    UPDATE ap.candidate_news AS candidate
    SET status = 'failed',
        error_log = v_error_code,
        render_started_at = NULL,
        render_attempts = COALESCE(candidate.render_attempts, 0) + 1
    WHERE candidate.id = p_candidate_id
    RETURNING candidate.* INTO v_candidate;

    RETURN jsonb_build_object(
        'candidate_news', to_jsonb(v_candidate),
        'released', true
    );
END;
$function$;

CREATE OR REPLACE FUNCTION ap.retry_territorial_composer_render(
    p_candidate_id uuid
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

    SELECT candidate.*
    INTO v_candidate
    FROM ap.candidate_news AS candidate
    WHERE candidate.id = p_candidate_id
    FOR UPDATE;

    IF NOT FOUND
       OR v_candidate.render_contract_version <> 'territorial_composer_v1'
       OR v_candidate.status <> 'failed'
       OR COALESCE(v_candidate.render_attempts, 0) >= 3 THEN
        RAISE EXCEPTION 'TERRITORIAL_RETRY_INVALID'
            USING ERRCODE = '23514';
    END IF;

    IF v_candidate.territorial_reservation_id IS NOT NULL THEN
        UPDATE ap.territorial_sponsor_reservations AS reservation
        SET status = 'reserved',
            reserved_at = now(),
            committed_at = NULL,
            released_at = NULL,
            release_reason = NULL
        WHERE reservation.id = v_candidate.territorial_reservation_id
          AND reservation.status = 'released';

        IF NOT FOUND THEN
            RAISE EXCEPTION 'RESERVATION_RETRY_INVALID'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    UPDATE ap.candidate_news AS candidate
    SET status = 'pending_render',
        render_started_at = NULL,
        error_log = NULL
    WHERE candidate.id = p_candidate_id
    RETURNING candidate.* INTO v_candidate;

    RETURN jsonb_build_object(
        'candidate_news', to_jsonb(v_candidate),
        'reused_reservation_id',
            v_candidate.territorial_reservation_id
    );
END;
$function$;
