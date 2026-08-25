-- Automatic territorial compositions require one region plus exactly two
-- active sponsors. A lone remainder is carried across the cycle boundary and
-- paired atomically in the next cycle so no Placid footer placeholder leaks
-- into a generated article.

CREATE OR REPLACE FUNCTION ap.create_territorial_composer_candidate(
    p_cliente_id uuid,
    p_idempotency_key uuid,
    p_content_type text,
    p_composer_mode text,
    p_titulo text,
    p_conteudo text,
    p_url_original text DEFAULT NULL,
    p_imagem_url text DEFAULT NULL,
    p_context_tag text DEFAULT 'DESTAQUE',
    p_region_id uuid DEFAULT NULL,
    p_city_id uuid DEFAULT NULL,
    p_visual_title_id uuid DEFAULT NULL,
    p_manual_slots jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, ap, public
AS $function$
DECLARE
    v_user_id uuid;
    v_creator_role text;
    v_content_type text := lower(btrim(COALESCE(p_content_type, '')));
    v_mode text := lower(btrim(COALESCE(p_composer_mode, '')));
    v_existing ap.candidate_news%ROWTYPE;
    v_candidate ap.candidate_news%ROWTYPE;
    v_template ap.territorial_composer_templates%ROWTYPE;
    v_region ap.territorial_regions%ROWTYPE;
    v_city ap.territorial_cities%ROWTYPE;
    v_title ap.visual_titles%ROWTYPE;
    v_sponsor ap.render_sponsors%ROWTYPE;
    v_candidate_id uuid := gen_random_uuid();
    v_reservation_id uuid;
    v_cycle bigint := 1;
    v_available_sponsor_ids uuid[] := '{}'::uuid[];
    v_used_sponsor_ids uuid[] := '{}'::uuid[];
    v_unused_sponsor_ids uuid[] := '{}'::uuid[];
    v_selected_sponsor_ids uuid[] := '{}'::uuid[];
    v_cycle_fill_sponsor_ids uuid[] := '{}'::uuid[];
    v_visual_title_snapshot jsonb;
    v_region_snapshot jsonb;
    v_city_snapshot jsonb;
    v_footer_slots jsonb := '[]'::jsonb;
    v_sponsor_items jsonb := '[]'::jsonb;
    v_manual_slots_normalized jsonb := '[]'::jsonb;
    v_request_intent jsonb;
    v_render_snapshot jsonb;
    v_slot jsonb;
    v_slot_name text;
    v_source_type text;
    v_source_id uuid;
    v_seen_slots text[] := '{}'::text[];
    v_manual_count integer := 0;
    v_sponsor_id uuid;
    v_sponsor_index integer := 0;
    v_is_automatic boolean;
BEGIN
    v_user_id := ap.require_territorial_composer_access(p_cliente_id);

    IF v_content_type NOT IN ('feed', 'reels', 'story') THEN
        RAISE EXCEPTION 'CONTENT_TYPE_INVALID'
            USING ERRCODE = '22023';
    END IF;
    IF v_mode NOT IN ('editorial', 'cities', 'individual') THEN
        RAISE EXCEPTION 'COMPOSER_MODE_INVALID'
            USING ERRCODE = '22023';
    END IF;
    IF p_idempotency_key IS NULL THEN
        RAISE EXCEPTION 'IDEMPOTENCY_KEY_INVALID'
            USING ERRCODE = '22023';
    END IF;
    IF length(btrim(COALESCE(p_titulo, ''))) < 2
       OR length(btrim(COALESCE(p_conteudo, ''))) < 5 THEN
        RAISE EXCEPTION 'CONTENT_INVALID'
            USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(COALESCE(p_manual_slots, '[]'::jsonb)) <> 'array' THEN
        RAISE EXCEPTION 'MANUAL_SLOTS_INVALID'
            USING ERRCODE = '22023';
    END IF;

    FOR v_slot IN
        SELECT value
        FROM jsonb_array_elements(COALESCE(p_manual_slots, '[]'::jsonb))
    LOOP
        IF jsonb_typeof(v_slot) <> 'object' THEN
            RAISE EXCEPTION 'MANUAL_SLOT_INVALID'
                USING ERRCODE = '22023';
        END IF;

        v_slot_name := lower(btrim(COALESCE(v_slot ->> 'slot', '')));
        v_source_type := lower(btrim(COALESCE(v_slot ->> 'source_type', '')));

        IF v_slot_name NOT IN (
            'footer_slot_1',
            'footer_slot_2',
            'footer_slot_3'
        ) OR v_source_type NOT IN ('region', 'sponsor') THEN
            RAISE EXCEPTION 'MANUAL_SLOT_INVALID'
                USING ERRCODE = '22023';
        END IF;
        IF v_slot_name = ANY(v_seen_slots) THEN
            RAISE EXCEPTION 'MANUAL_SLOT_DUPLICATE'
                USING ERRCODE = '22023';
        END IF;
        IF COALESCE(v_slot ->> 'source_id', '') !~
            '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' THEN
            RAISE EXCEPTION 'MANUAL_SLOT_INVALID'
                USING ERRCODE = '22023';
        END IF;

        v_source_id := (v_slot ->> 'source_id')::uuid;
        v_seen_slots := array_append(v_seen_slots, v_slot_name);
        v_manual_count := v_manual_count + 1;
        IF v_manual_count > 3 THEN
            RAISE EXCEPTION 'MANUAL_SLOT_LIMIT_EXCEEDED'
                USING ERRCODE = '22023';
        END IF;

        v_manual_slots_normalized := v_manual_slots_normalized ||
            jsonb_build_array(
                jsonb_build_object(
                    'slot', v_slot_name,
                    'source_type', v_source_type,
                    'source_id', v_source_id
                )
            );
    END LOOP;

    SELECT COALESCE(
        jsonb_agg(slot_value ORDER BY slot_value ->> 'slot'),
        '[]'::jsonb
    )
    INTO v_manual_slots_normalized
    FROM jsonb_array_elements(v_manual_slots_normalized) AS slot_value;

    v_request_intent := jsonb_build_object(
        'content_type', v_content_type,
        'composer_mode', v_mode,
        'titulo', btrim(p_titulo),
        'conteudo', btrim(p_conteudo),
        'url_original', NULLIF(btrim(COALESCE(p_url_original, '')), ''),
        'imagem_url', NULLIF(btrim(COALESCE(p_imagem_url, '')), ''),
        'context_tag', upper(btrim(COALESCE(p_context_tag, 'DESTAQUE'))),
        'region_id', p_region_id,
        'city_id', p_city_id,
        'visual_title_id', p_visual_title_id,
        'manual_slots', v_manual_slots_normalized
    );

    SELECT candidate.*
    INTO v_existing
    FROM ap.candidate_news AS candidate
    WHERE candidate.cliente_id = p_cliente_id
      AND candidate.idempotency_key = p_idempotency_key
    FOR UPDATE;

    IF FOUND THEN
        IF v_existing.render_contract_version <> 'territorial_composer_v1'
           OR v_existing.render_snapshot -> 'request_intent'
                IS DISTINCT FROM v_request_intent THEN
            RAISE EXCEPTION 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH'
                USING ERRCODE = '23505';
        END IF;

        IF v_existing.territorial_reservation_id IS NOT NULL THEN
            UPDATE ap.territorial_sponsor_reservations AS reservation
            SET status = 'reserved',
                reserved_at = now(),
                committed_at = NULL,
                released_at = NULL,
                release_reason = NULL
            WHERE reservation.id = v_existing.territorial_reservation_id
              AND reservation.cliente_id = p_cliente_id
              AND reservation.status = 'released';
        END IF;

        IF v_existing.status = 'failed' THEN
            UPDATE ap.candidate_news AS candidate
            SET status = 'processing',
                processing_started_at = NULL,
                render_started_at = NULL,
                error_log = NULL
            WHERE candidate.id = v_existing.id
            RETURNING candidate.* INTO v_existing;
        END IF;

        RETURN jsonb_build_object(
            'candidate_news', to_jsonb(v_existing),
            'reservation_id', v_existing.territorial_reservation_id,
            'reused', true
        );
    END IF;

    SELECT config.*
    INTO v_template
    FROM ap.territorial_composer_templates AS config
    WHERE config.cliente_id = p_cliente_id
      AND config.content_type = v_content_type
      AND config.ativo;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'COMPOSER_TEMPLATE_UNAVAILABLE'
            USING ERRCODE = '23514';
    END IF;

    IF v_template.layer_map ? 'news_image' THEN
        IF NULLIF(btrim(COALESCE(p_imagem_url, '')), '') IS NULL
           OR NULLIF(btrim(COALESCE(p_imagem_url, '')), '')
                !~* '^https?://' THEN
            RAISE EXCEPTION 'SOURCE_IMAGE_INVALID'
                USING ERRCODE = '23514';
        END IF;
    ELSIF NULLIF(btrim(COALESCE(p_imagem_url, '')), '') IS NOT NULL THEN
        RAISE EXCEPTION 'SOURCE_IMAGE_NOT_SUPPORTED'
            USING ERRCODE = '23514';
    END IF;

    SELECT membership.funcao
    INTO v_creator_role
    FROM public.cliente_profissionais AS membership
    WHERE membership.cliente_id = p_cliente_id
      AND membership.profissional_id = v_user_id
      AND COALESCE(membership.ativo, true)
    ORDER BY membership.created_at
    LIMIT 1;

    v_is_automatic := v_mode IN ('editorial', 'cities');

    IF v_mode = 'editorial' THEN
        IF p_region_id IS NULL
           OR p_visual_title_id IS NULL
           OR p_city_id IS NOT NULL
           OR v_manual_count <> 0 THEN
            RAISE EXCEPTION 'EDITORIAL_INTENT_INVALID'
                USING ERRCODE = '22023';
        END IF;

        SELECT region.*
        INTO v_region
        FROM ap.territorial_regions AS region
        WHERE region.cliente_id = p_cliente_id
          AND region.id = p_region_id
          AND region.ativo;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'REGION_UNAVAILABLE'
                USING ERRCODE = '23514';
        END IF;

        SELECT title.*
        INTO v_title
        FROM ap.visual_titles AS title
        LEFT JOIN ap.visual_title_groups AS title_group
          ON title_group.cliente_id = title.cliente_id
         AND title_group.id = title.group_id
        WHERE title.cliente_id = p_cliente_id
          AND title.id = p_visual_title_id
          AND title.ativo
          AND title.tipo = 'editorial'
          AND (
              v_content_type = 'story'
              OR title.formatos @> ARRAY[v_content_type]::text[]
          )
          AND (
              title.group_id IS NULL
              OR title_group.ativo
          );
        IF NOT FOUND THEN
            RAISE EXCEPTION 'EDITORIAL_TITLE_UNAVAILABLE'
                USING ERRCODE = '23514';
        END IF;

    ELSIF v_mode = 'cities' THEN
        IF p_city_id IS NULL
           OR p_region_id IS NOT NULL
           OR p_visual_title_id IS NOT NULL
           OR v_manual_count <> 0 THEN
            RAISE EXCEPTION 'CITY_INTENT_INVALID'
                USING ERRCODE = '22023';
        END IF;

        SELECT city.*
        INTO v_city
        FROM ap.territorial_cities AS city
        WHERE city.cliente_id = p_cliente_id
          AND city.id = p_city_id
          AND city.ativo;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'CITY_UNAVAILABLE'
                USING ERRCODE = '23514';
        END IF;

        SELECT region.*
        INTO v_region
        FROM ap.territorial_regions AS region
        WHERE region.cliente_id = p_cliente_id
          AND region.id = v_city.region_id
          AND region.ativo;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'REGION_UNAVAILABLE'
                USING ERRCODE = '23514';
        END IF;

        SELECT title.*
        INTO v_title
        FROM ap.visual_titles AS title
        LEFT JOIN ap.visual_title_groups AS title_group
          ON title_group.cliente_id = title.cliente_id
         AND title_group.id = title.group_id
        WHERE title.cliente_id = p_cliente_id
          AND title.id = v_city.visual_title_id
          AND title.ativo
          AND title.tipo = 'cidade'
          AND (
              v_content_type = 'story'
              OR title.formatos @> ARRAY[v_content_type]::text[]
          )
          AND (
              title.group_id IS NULL
              OR title_group.ativo
          );
        IF NOT FOUND THEN
            RAISE EXCEPTION 'CITY_TITLE_INCONSISTENT'
                USING ERRCODE = '23514';
        END IF;

    ELSE
        IF p_region_id IS NOT NULL
           OR p_city_id IS NOT NULL
           OR v_manual_count NOT BETWEEN 1 AND 3 THEN
            RAISE EXCEPTION 'INDIVIDUAL_INTENT_INVALID'
                USING ERRCODE = '22023';
        END IF;

        IF v_content_type = 'story' THEN
            IF p_visual_title_id IS NOT NULL THEN
                RAISE EXCEPTION 'STORY_VISUAL_TITLE_FORBIDDEN'
                    USING ERRCODE = '22023';
            END IF;
        ELSE
            IF p_visual_title_id IS NULL THEN
                RAISE EXCEPTION 'VISUAL_TITLE_REQUIRED'
                    USING ERRCODE = '22023';
            END IF;

            SELECT title.*
            INTO v_title
            FROM ap.visual_titles AS title
            LEFT JOIN ap.visual_title_groups AS title_group
              ON title_group.cliente_id = title.cliente_id
             AND title_group.id = title.group_id
            WHERE title.cliente_id = p_cliente_id
              AND title.id = p_visual_title_id
              AND title.ativo
              AND title.formatos @> ARRAY[v_content_type]::text[]
              AND (
                  title.group_id IS NULL
                  OR title_group.ativo
              );
            IF NOT FOUND THEN
                RAISE EXCEPTION 'VISUAL_TITLE_UNAVAILABLE'
                    USING ERRCODE = '23514';
            END IF;
        END IF;
    END IF;

    IF v_title.id IS NOT NULL THEN
        v_visual_title_snapshot := jsonb_build_object(
            'id', v_title.id,
            'name', v_title.nome,
            'type', v_title.tipo,
            'bucket', v_title.asset_bucket,
            'path', v_title.asset_path,
            'version', v_title.asset_version,
            'sha256', v_title.sha256
        );
    END IF;

    IF v_region.id IS NOT NULL THEN
        v_region_snapshot := jsonb_build_object(
            'id', v_region.id,
            'name', v_region.nome,
            'bucket', v_region.asset_bucket,
            'path', v_region.asset_path,
            'version', v_region.asset_version,
            'sha256', v_region.sha256
        );
    END IF;

    IF v_city.id IS NOT NULL THEN
        v_city_snapshot := jsonb_build_object(
            'id', v_city.id,
            'name', v_city.nome,
            'region_id', v_city.region_id,
            'visual_title_id', v_city.visual_title_id,
            'bucket', v_city.asset_bucket,
            'path', v_city.asset_path,
            'version', v_city.asset_version,
            'sha256', v_city.sha256
        );
    END IF;

    IF v_is_automatic THEN
        v_footer_slots := jsonb_build_array(
            jsonb_build_object(
                'slot', 'footer_slot_1',
                'source_type', 'region',
                'source_id', v_region.id,
                'name', v_region.nome,
                'bucket', v_region.asset_bucket,
                'path', v_region.asset_path,
                'version', v_region.asset_version,
                'sha256', v_region.sha256
            )
        );

        INSERT INTO ap.territorial_sponsor_rotation_state (
            cliente_id,
            region_id,
            content_type
        )
        VALUES (
            p_cliente_id,
            v_region.id,
            v_content_type
        )
        ON CONFLICT (cliente_id, region_id, content_type)
        DO NOTHING;

        SELECT state.current_cycle
        INTO v_cycle
        FROM ap.territorial_sponsor_rotation_state AS state
        WHERE state.cliente_id = p_cliente_id
          AND state.region_id = v_region.id
          AND state.content_type = v_content_type
        FOR UPDATE;

        SELECT COALESCE(
            array_agg(sponsor.id ORDER BY link.created_at, link.id),
            '{}'::uuid[]
        )
        INTO v_available_sponsor_ids
        FROM ap.territorial_region_sponsors AS link
        JOIN ap.render_sponsors AS sponsor
          ON sponsor.cliente_id = link.cliente_id
         AND sponsor.id = link.sponsor_id
        WHERE link.cliente_id = p_cliente_id
          AND link.region_id = v_region.id
          AND link.ativo
          AND sponsor.ativo;

        IF cardinality(v_available_sponsor_ids) < 2 THEN
            RAISE EXCEPTION 'TERRITORIAL_SPONSOR_POOL_INSUFFICIENT'
                USING ERRCODE = '23514';
        END IF;

        SELECT COALESCE(
            array_agg(DISTINCT selected_id),
            '{}'::uuid[]
        )
        INTO v_used_sponsor_ids
        FROM ap.territorial_sponsor_reservations AS reservation
        CROSS JOIN LATERAL unnest(
            reservation.selected_sponsor_ids
        ) AS selected_id
        WHERE reservation.cliente_id = p_cliente_id
          AND reservation.region_id = v_region.id
          AND reservation.content_type = v_content_type
          AND reservation.cycle = v_cycle
          AND reservation.status IN ('reserved', 'committed');

        SELECT COALESCE(
            array_agg(available_id ORDER BY ordinal_position),
            '{}'::uuid[]
        )
        INTO v_unused_sponsor_ids
        FROM unnest(v_available_sponsor_ids)
            WITH ORDINALITY AS pool(available_id, ordinal_position)
        WHERE NOT (
            available_id = ANY(v_used_sponsor_ids)
        );

        IF cardinality(v_unused_sponsor_ids) = 0 THEN
            v_cycle := v_cycle + 1;
            UPDATE ap.territorial_sponsor_rotation_state AS state
            SET current_cycle = v_cycle
            WHERE state.cliente_id = p_cliente_id
              AND state.region_id = v_region.id
              AND state.content_type = v_content_type;
            v_unused_sponsor_ids := v_available_sponsor_ids;
        ELSIF cardinality(v_unused_sponsor_ids) = 1 THEN
            -- Carry the final unused sponsor across the cycle boundary and
            -- pair it with the first distinct sponsor of the new cycle.
            -- Recording both in the new cycle preserves fairness and prevents
            -- the automatic template from receiving an empty footer slot.
            v_selected_sponsor_ids := v_unused_sponsor_ids;
            v_cycle := v_cycle + 1;
            UPDATE ap.territorial_sponsor_rotation_state AS state
            SET current_cycle = v_cycle
            WHERE state.cliente_id = p_cliente_id
              AND state.region_id = v_region.id
              AND state.content_type = v_content_type;

            SELECT COALESCE(
                array_agg(available_id ORDER BY ordinal_position),
                '{}'::uuid[]
            )
            INTO v_cycle_fill_sponsor_ids
            FROM (
                SELECT available_id, ordinal_position
                FROM unnest(v_available_sponsor_ids)
                    WITH ORDINALITY AS available(
                        available_id,
                        ordinal_position
                    )
                WHERE NOT (
                    available_id = ANY(v_selected_sponsor_ids)
                )
                ORDER BY
                    CASE
                        WHEN ordinal_position > (
                            SELECT remainder.ordinal_position
                            FROM unnest(v_available_sponsor_ids)
                                WITH ORDINALITY AS remainder(
                                    sponsor_id,
                                    ordinal_position
                                )
                            WHERE remainder.sponsor_id =
                                v_selected_sponsor_ids[1]
                        ) THEN 0
                        ELSE 1
                    END,
                    ordinal_position
                LIMIT 1
            ) AS cycle_fill;

            v_selected_sponsor_ids :=
                v_selected_sponsor_ids || v_cycle_fill_sponsor_ids;
        END IF;

        IF cardinality(v_selected_sponsor_ids) = 0 THEN
            SELECT COALESCE(
                array_agg(available_id ORDER BY ordinal_position),
                '{}'::uuid[]
            )
            INTO v_selected_sponsor_ids
            FROM (
                SELECT available_id, ordinal_position
                FROM unnest(v_unused_sponsor_ids)
                    WITH ORDINALITY AS unused(
                        available_id,
                        ordinal_position
                    )
                ORDER BY ordinal_position
                LIMIT 2
            ) AS selection;
        END IF;

        IF cardinality(v_selected_sponsor_ids) <> 2 THEN
            RAISE EXCEPTION 'TERRITORIAL_SPONSOR_PAIR_INCOMPLETE'
                USING ERRCODE = '23514';
        END IF;

        v_reservation_id := gen_random_uuid();

        FOREACH v_sponsor_id IN ARRAY v_selected_sponsor_ids
        LOOP
            v_sponsor_index := v_sponsor_index + 1;
            v_slot_name := CASE v_sponsor_index
                WHEN 1 THEN 'footer_slot_2'
                ELSE 'footer_slot_3'
            END;

            SELECT sponsor.*
            INTO v_sponsor
            FROM ap.render_sponsors AS sponsor
            WHERE sponsor.cliente_id = p_cliente_id
              AND sponsor.id = v_sponsor_id;

            v_sponsor_items := v_sponsor_items ||
                jsonb_build_array(
                    jsonb_build_object(
                        'slot', v_slot_name,
                        'sponsor_id', v_sponsor.id,
                        'name', v_sponsor.nome,
                        'bucket', v_sponsor.asset_bucket,
                        'path', v_sponsor.asset_path,
                        'version', v_sponsor.asset_version,
                        'sha256', v_sponsor.sha256
                    )
                );
            v_footer_slots := v_footer_slots ||
                jsonb_build_array(
                    jsonb_build_object(
                        'slot', v_slot_name,
                        'source_type', 'sponsor',
                        'source_id', v_sponsor.id,
                        'name', v_sponsor.nome,
                        'bucket', v_sponsor.asset_bucket,
                        'path', v_sponsor.asset_path,
                        'version', v_sponsor.asset_version,
                        'sha256', v_sponsor.sha256
                    )
                );
        END LOOP;
    ELSE
        FOR v_slot IN
            SELECT value
            FROM jsonb_array_elements(v_manual_slots_normalized)
            ORDER BY value ->> 'slot'
        LOOP
            v_slot_name := v_slot ->> 'slot';
            v_source_type := v_slot ->> 'source_type';
            v_source_id := (v_slot ->> 'source_id')::uuid;

            IF v_source_type = 'region' THEN
                SELECT region.*
                INTO v_region
                FROM ap.territorial_regions AS region
                WHERE region.cliente_id = p_cliente_id
                  AND region.id = v_source_id
                  AND region.ativo;
                IF NOT FOUND THEN
                    RAISE EXCEPTION 'MANUAL_ASSET_UNAVAILABLE'
                        USING ERRCODE = '23514';
                END IF;

                v_footer_slots := v_footer_slots ||
                    jsonb_build_array(
                        jsonb_build_object(
                            'slot', v_slot_name,
                            'source_type', 'region',
                            'source_id', v_region.id,
                            'name', v_region.nome,
                            'bucket', v_region.asset_bucket,
                            'path', v_region.asset_path,
                            'version', v_region.asset_version,
                            'sha256', v_region.sha256
                        )
                    );
            ELSE
                SELECT sponsor.*
                INTO v_sponsor
                FROM ap.render_sponsors AS sponsor
                WHERE sponsor.cliente_id = p_cliente_id
                  AND sponsor.id = v_source_id
                  AND sponsor.ativo;
                IF NOT FOUND THEN
                    RAISE EXCEPTION 'MANUAL_ASSET_UNAVAILABLE'
                        USING ERRCODE = '23514';
                END IF;

                v_footer_slots := v_footer_slots ||
                    jsonb_build_array(
                        jsonb_build_object(
                            'slot', v_slot_name,
                            'source_type', 'sponsor',
                            'source_id', v_sponsor.id,
                            'name', v_sponsor.nome,
                            'bucket', v_sponsor.asset_bucket,
                            'path', v_sponsor.asset_path,
                            'version', v_sponsor.asset_version,
                            'sha256', v_sponsor.sha256
                        )
                    );
            END IF;
        END LOOP;
    END IF;

    v_render_snapshot := jsonb_build_object(
        'render_contract_version', 'territorial_composer_v1',
        'request_intent', v_request_intent,
        'composer', jsonb_build_object(
            'mode', v_mode,
            'content_type', v_content_type
        ),
        'template', jsonb_build_object(
            'config_id', v_template.id,
            'master_template_uuid', v_template.master_template_uuid
        ),
        'layer_map', v_template.layer_map,
        'region', v_region_snapshot,
        'city', v_city_snapshot,
        'visual_title', v_visual_title_snapshot,
        'footer_slots', v_footer_slots,
        'sponsor_selection',
            CASE
                WHEN v_is_automatic THEN jsonb_build_object(
                    'rotation_version',
                        'territorial_region_rotation_v1',
                    'reservation_id', v_reservation_id,
                    'region_id', v_region.id,
                    'cycle', v_cycle,
                    'requested_count', 2,
                    'selected_count',
                        cardinality(v_selected_sponsor_ids),
                    'items', v_sponsor_items
                )
                ELSE jsonb_build_object(
                    'rotation_version', 'manual_slots_v1',
                    'reservation_id', NULL,
                    'requested_count', 0,
                    'selected_count', 0,
                    'items', '[]'::jsonb
                )
            END
    );

    INSERT INTO ap.candidate_news (
        id,
        cliente_id,
        status,
        titulo,
        conteudo,
        url_original,
        imagem_url,
        headline,
        context_tag,
        content_type,
        template_set,
        criado_por_user_id,
        role_criador,
        placid_template_uuid,
        visual_title_id,
        render_contract_version,
        render_snapshot,
        sponsor_count,
        idempotency_key,
        territorial_reservation_id
    )
    VALUES (
        v_candidate_id,
        p_cliente_id,
        'processing',
        btrim(p_titulo),
        btrim(p_conteudo),
        COALESCE(NULLIF(btrim(COALESCE(p_url_original, '')), ''), ''),
        NULLIF(btrim(COALESCE(p_imagem_url, '')), ''),
        btrim(p_titulo),
        upper(btrim(COALESCE(p_context_tag, 'DESTAQUE'))),
        v_content_type,
        'territorial',
        v_user_id,
        COALESCE(v_creator_role, 'editor'),
        v_template.master_template_uuid,
        v_title.id,
        'territorial_composer_v1',
        v_render_snapshot,
        CASE
            WHEN v_is_automatic
                THEN cardinality(v_selected_sponsor_ids)::smallint
            ELSE 0::smallint
        END,
        p_idempotency_key,
        v_reservation_id
    )
    RETURNING * INTO v_candidate;

    IF v_is_automatic THEN
        INSERT INTO ap.territorial_sponsor_reservations (
            id,
            cliente_id,
            region_id,
            candidate_id,
            content_type,
            composer_mode,
            cycle,
            selected_sponsor_ids,
            status
        )
        VALUES (
            v_reservation_id,
            p_cliente_id,
            v_region.id,
            v_candidate.id,
            v_content_type,
            v_mode,
            v_cycle,
            v_selected_sponsor_ids,
            'reserved'
        );
    END IF;

    RETURN jsonb_build_object(
        'candidate_news', to_jsonb(v_candidate),
        'reservation_id', v_reservation_id,
        'reused', false
    );
END;
$function$;
