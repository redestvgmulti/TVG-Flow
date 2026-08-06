-- Resolve the agency client from versioned company classification and JWT membership.
-- This replaces the historical dependency on the unversioned public.clientes.tipo.
CREATE OR REPLACE FUNCTION public.get_agencia_cliente_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, ap, pg_temp
AS $$
DECLARE
    v_user_id uuid := auth.uid();
    v_cliente_ids uuid[];
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'AUTH_REQUIRED';
    END IF;

    SELECT array_agg(candidate.id ORDER BY candidate.created_at, candidate.id)
    INTO v_cliente_ids
    FROM (
        SELECT DISTINCT c.id, c.created_at
        FROM ap.get_user_cliente_ids() AS allowed(cliente_id)
        JOIN public.clientes AS c
          ON c.id = allowed.cliente_id
        JOIN public.empresas AS e
          ON e.id = c.empresa_id
        WHERE c.ativo IS TRUE
          AND e.ativo IS TRUE
          AND e.tipo_negocio = 'agency'
    ) AS candidate;

    IF COALESCE(array_length(v_cliente_ids, 1), 0) = 0 THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'AGENCY_CLIENT_NOT_FOUND';
    END IF;

    IF array_length(v_cliente_ids, 1) > 1 THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'AGENCY_CLIENT_SELECTION_REQUIRED';
    END IF;

    RETURN v_cliente_ids[1];
END;
$$;

REVOKE ALL ON FUNCTION public.get_agencia_cliente_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_agencia_cliente_id() FROM anon;

GRANT EXECUTE ON FUNCTION public.get_agencia_cliente_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_agencia_cliente_id() TO service_role;

COMMENT ON FUNCTION public.get_agencia_cliente_id() IS
    'Returns the caller''s single active agency-classified cliente membership. '
    'Agency classification comes from public.empresas.tipo_negocio; ambiguous '
    'or missing memberships fail closed.';
