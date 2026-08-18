-- Canonical operational-client resolver for new flows.
-- It is deliberately additive: public.get_my_cliente_id() remains unchanged
-- until unknown external callers have been migrated and observed.
CREATE OR REPLACE FUNCTION public.require_single_operational_cliente_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id uuid := auth.uid();
    v_profile public.profissionais%ROWTYPE;
    v_cliente_ids uuid[];
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '28000', MESSAGE = 'AUTH_REQUIRED';
    END IF;

    SELECT *
      INTO v_profile
      FROM public.profissionais
     WHERE id = v_user_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'PROFILE_NOT_FOUND';
    END IF;

    IF v_profile.ativo IS NOT TRUE THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'PROFILE_INACTIVE';
    END IF;

    -- A global operator must always name the target client explicitly.
    IF v_profile.role = 'super_admin' THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'OPERATIONAL_CLIENT_SELECTION_REQUIRED';
    END IF;

    SELECT array_agg(allowed.cliente_id ORDER BY allowed.cliente_id)
      INTO v_cliente_ids
      FROM ap.get_operational_cliente_ids() AS allowed(cliente_id);

    IF COALESCE(array_length(v_cliente_ids, 1), 0) = 0 THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'OPERATIONAL_CLIENT_NOT_FOUND';
    END IF;

    IF array_length(v_cliente_ids, 1) <> 1 THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'OPERATIONAL_CLIENT_SELECTION_REQUIRED';
    END IF;

    RETURN v_cliente_ids[1];
END;
$$;

REVOKE ALL ON FUNCTION public.require_single_operational_cliente_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.require_single_operational_cliente_id() FROM anon;
GRANT EXECUTE ON FUNCTION public.require_single_operational_cliente_id()
    TO authenticated;

COMMENT ON FUNCTION public.require_single_operational_cliente_id() IS
    'Fail-closed resolver for new flows. Never use get_my_cliente_id() for new authorization paths.';
