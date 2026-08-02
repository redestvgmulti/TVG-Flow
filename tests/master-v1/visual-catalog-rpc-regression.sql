-- Runtime regression contract. Execute after applying the visual catalog
-- migration inside an outer transaction that will be rolled back.
DO $rpc_regression$
DECLARE
    v_cliente_id constant uuid := 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    v_unit_result jsonb;
    v_pair_result jsonb;
    v_retry_result jsonb;
    v_cursor integer;
BEGIN
    PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);

    INSERT INTO public.clientes (id, nome)
    VALUES (v_cliente_id, 'AutoPublisher RPC regression')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO ap.render_sponsors (
        id, cliente_id, nome, slug,
        asset_bucket, asset_path, asset_version, sha256, ativo
    )
    VALUES
        (
            'eeeeeeee-0000-4000-8000-000000000001'::uuid,
            v_cliente_id,
            'Sponsor A',
            'sponsor-a',
            'ap-images',
            'sponsors/a.png',
            'v1',
            repeat('a', 64),
            true
        ),
        (
            'eeeeeeee-0000-4000-8000-000000000002'::uuid,
            v_cliente_id,
            'Sponsor B',
            'sponsor-b',
            'ap-images',
            'sponsors/b.png',
            'v1',
            repeat('b', 64),
            true
        );

    INSERT INTO ap.render_sponsor_scope_memberships (
        sponsor_id, cliente_id, template_set, content_type, ordem, ativo
    )
    VALUES
        ('eeeeeeee-0000-4000-8000-000000000001'::uuid, v_cliente_id, 'unit', 'feed', 0, true),
        ('eeeeeeee-0000-4000-8000-000000000001'::uuid, v_cliente_id, 'default', 'feed', 0, true),
        ('eeeeeeee-0000-4000-8000-000000000002'::uuid, v_cliente_id, 'default', 'feed', 1, true);

    INSERT INTO ap.render_sponsor_rotation_state (
        cliente_id, template_set, content_type, current_index
    )
    VALUES (v_cliente_id, 'default', 'feed', 7);

    v_unit_result := ap.create_candidate_with_sponsors_core_v1(
        p_cliente_id => v_cliente_id,
        p_idempotency_key => 'eeeeeeee-1000-4000-8000-000000000001'::uuid,
        p_content_type => 'feed',
        p_template_set => 'unit',
        p_sponsor_count => 1::smallint,
        p_titulo => 'Unit pool remains valid',
        p_render_contract_version => 'master_v1',
        p_render_snapshot_base => jsonb_build_object(
            'master_config', jsonb_build_object(
                'master_template_uuid', 'unit-pool-template'
            )
        )
    );

    IF jsonb_array_length(v_unit_result #> '{sponsor_selection,items}') <> 1
       OR v_unit_result #>> '{sponsor_selection,cursor_before}' <> '0'
       OR v_unit_result #>> '{sponsor_selection,cursor_after}' <> '0' THEN
        RAISE EXCEPTION 'UNIT_POOL_ONE_SLOT_REGRESSION';
    END IF;

    v_pair_result := ap.create_candidate_with_sponsors_core_v1(
        p_cliente_id => v_cliente_id,
        p_idempotency_key => 'eeeeeeee-1000-4000-8000-000000000002'::uuid,
        p_content_type => 'feed',
        p_template_set => 'default',
        p_sponsor_count => 2::smallint,
        p_titulo => 'Two distinct sponsors remain valid',
        p_render_contract_version => 'master_v1',
        p_render_snapshot_base => jsonb_build_object(
            'master_config', jsonb_build_object(
                'master_template_uuid', 'two-slot-template'
            )
        )
    );

    IF v_pair_result #>> '{sponsor_selection,cursor_before}' <> '1'
       OR v_pair_result #>> '{sponsor_selection,cursor_after}' <> '1' THEN
        RAISE EXCEPTION 'EXISTING_CURSOR_REGRESSION';
    END IF;

    IF v_pair_result #>> '{sponsor_selection,items,0,sponsor_id}'
       = v_pair_result #>> '{sponsor_selection,items,1,sponsor_id}' THEN
        RAISE EXCEPTION 'TWO_SLOT_SPONSOR_DUPLICATION';
    END IF;

    v_retry_result := ap.create_candidate_with_sponsors_core_v1(
        p_cliente_id => v_cliente_id,
        p_idempotency_key => 'eeeeeeee-1000-4000-8000-000000000002'::uuid,
        p_content_type => 'feed',
        p_template_set => 'default',
        p_sponsor_count => 2::smallint,
        p_titulo => 'Two distinct sponsors remain valid',
        p_render_contract_version => 'master_v1',
        p_render_snapshot_base => jsonb_build_object(
            'master_config', jsonb_build_object(
                'master_template_uuid', 'two-slot-template'
            )
        )
    );

    IF COALESCE((v_retry_result ->> 'reused')::boolean, false) IS NOT TRUE
       OR v_retry_result -> 'sponsor_selection'
          IS DISTINCT FROM v_pair_result -> 'sponsor_selection' THEN
        RAISE EXCEPTION 'IDEMPOTENT_SPONSOR_SNAPSHOT_REGRESSION';
    END IF;

    SELECT state.current_index
    INTO STRICT v_cursor
    FROM ap.render_sponsor_rotation_state AS state
    WHERE state.cliente_id = v_cliente_id
      AND state.template_set = 'default'
      AND state.content_type = 'feed';

    IF v_cursor <> 1 THEN
        RAISE EXCEPTION 'RETRY_ADVANCED_CURSOR expected=1 actual=%', v_cursor;
    END IF;
END;
$rpc_regression$;
