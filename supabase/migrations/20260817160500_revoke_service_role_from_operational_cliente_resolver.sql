-- The project has legacy default privileges that grant newly-created public
-- functions to service_role. Override that default for this user-facing
-- resolver without changing global default privileges.
REVOKE ALL ON FUNCTION public.require_single_operational_cliente_id()
    FROM service_role;

-- Keep the intended invocation contract explicit after the targeted revoke.
REVOKE ALL ON FUNCTION public.require_single_operational_cliente_id()
    FROM PUBLIC;
REVOKE ALL ON FUNCTION public.require_single_operational_cliente_id()
    FROM anon;
GRANT EXECUTE ON FUNCTION public.require_single_operational_cliente_id()
    TO authenticated;
