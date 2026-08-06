-- Resolve the AutoPublisher client from the caller's active, versioned tenant
-- memberships.  The historical `tipo_negocio = 'agency'` filter is a
-- commercial classification and is not the authorization boundary.
--
-- This remains fail-closed: no active client or more than one reachable client
-- raises an explicit error; no tenant is selected by position or globally.
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
        FROM public.clientes AS c
        JOIN public.empresas AS client_empresa
          ON client_empresa.id = c.empresa_id
        WHERE c.ativo IS TRUE
          AND client_empresa.ativo IS TRUE
          AND (
              EXISTS (
                  SELECT 1
                  FROM ap.get_user_cliente_ids() AS direct(cliente_id)
                  WHERE direct.cliente_id = c.id
              )
              OR EXISTS (
                  SELECT 1
                  FROM public.empresa_profissionais AS ep
                  JOIN public.empresas AS tenant_empresa
                    ON tenant_empresa.id = ep.empresa_id
                  WHERE ep.profissional_id = v_user_id
                    AND ep.ativo IS TRUE
                    AND tenant_empresa.ativo IS TRUE
                    AND tenant_empresa.empresa_tipo = 'tenant'
                    AND (
                        client_empresa.id = tenant_empresa.id
                        OR client_empresa.tenant_id = tenant_empresa.id
                    )
              )
          )
    ) AS candidate;

    IF COALESCE(array_length(v_cliente_ids, 1), 0) = 0 THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'OPERATIONAL_CLIENT_NOT_FOUND';
    END IF;

    IF array_length(v_cliente_ids, 1) > 1 THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'OPERATIONAL_CLIENT_SELECTION_REQUIRED';
    END IF;

    RETURN v_cliente_ids[1];
END;
$$;

REVOKE ALL ON FUNCTION public.get_agencia_cliente_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_agencia_cliente_id() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_agencia_cliente_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_agencia_cliente_id() TO service_role;

COMMENT ON FUNCTION public.get_agencia_cliente_id() IS
    'Returns the caller''s single active AutoPublisher client from explicit '
    'client membership or active tenant membership. Missing and ambiguous '
    'memberships fail closed.';
