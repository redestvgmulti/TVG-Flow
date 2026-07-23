-- Generator tenant authorization must execute in the caller JWT context.
-- The service-role client is created only after this lookup succeeds.
ALTER FUNCTION ap.get_user_cliente_ids()
  SET search_path = ap, public, pg_temp;

REVOKE ALL ON FUNCTION ap.get_user_cliente_ids() FROM PUBLIC;
REVOKE ALL ON FUNCTION ap.get_user_cliente_ids() FROM anon;

GRANT EXECUTE ON FUNCTION ap.get_user_cliente_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION ap.get_user_cliente_ids() TO service_role;

COMMENT ON FUNCTION ap.get_user_cliente_ids() IS
  'Returns the active cliente memberships for auth.uid(); used to authorize '
  'the AutoPublisher caller before any service-role operation.';
