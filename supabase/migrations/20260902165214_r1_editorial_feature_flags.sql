-- R1 / Migration 1: private, tenant-scoped editorial workflow flag.
-- The absence of a row is deliberately equivalent to OFF. This migration does
-- not enable any tenant and does not touch legacy editorial production data.
BEGIN;

CREATE TABLE ap.editorial_feature_flags (
    cliente_id uuid PRIMARY KEY
        REFERENCES public.clientes(id) ON DELETE RESTRICT,
    editorial_workflow_v1_enabled boolean NOT NULL DEFAULT false,
    updated_by_user_id uuid NOT NULL
        REFERENCES public.profissionais(id) ON DELETE RESTRICT,
    updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE ap.editorial_feature_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE ap.editorial_feature_flags FORCE ROW LEVEL SECURITY;

-- This is an RPC-only private table. Do not add browser-facing policies or
-- table grants: PostgreSQL privileges deny direct access before RLS is reached.
REVOKE ALL ON TABLE ap.editorial_feature_flags FROM PUBLIC;
REVOKE ALL ON TABLE ap.editorial_feature_flags FROM anon;
REVOKE ALL ON TABLE ap.editorial_feature_flags FROM authenticated;
REVOKE ALL ON TABLE ap.editorial_feature_flags FROM service_role;

CREATE FUNCTION ap.get_editorial_workflow_status()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_cliente_id uuid;
BEGIN
    -- No caller-supplied tenant is accepted. The canonical resolver rejects
    -- zero, multiple and super-admin-without-selection contexts.
    v_cliente_id := public.require_single_operational_cliente_id();

    RETURN COALESCE((
        SELECT flags.editorial_workflow_v1_enabled
          FROM ap.editorial_feature_flags AS flags
         WHERE flags.cliente_id = v_cliente_id
    ), false);
END;
$function$;

CREATE FUNCTION ap.set_editorial_workflow_v1_enabled(
    p_editorial_workflow_v1_enabled boolean
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_cliente_id uuid;
    v_actor record;
    v_enabled boolean;
BEGIN
    IF p_editorial_workflow_v1_enabled IS NULL THEN
        RAISE EXCEPTION 'EDITORIAL_WORKFLOW_FLAG_VALUE_REQUIRED'
            USING ERRCODE = '22023';
    END IF;

    -- Resolve before checking administrative authority so a global operator
    -- never gets an implicit tenant through this RPC.
    v_cliente_id := public.require_single_operational_cliente_id();
    SELECT *
      INTO v_actor
      FROM ap.require_editorial_admin_access(v_cliente_id);

    INSERT INTO ap.editorial_feature_flags AS flags (
        cliente_id,
        editorial_workflow_v1_enabled,
        updated_by_user_id,
        updated_at
    ) VALUES (
        v_cliente_id,
        p_editorial_workflow_v1_enabled,
        v_actor.user_id,
        now()
    )
    ON CONFLICT (cliente_id) DO UPDATE
       SET editorial_workflow_v1_enabled = EXCLUDED.editorial_workflow_v1_enabled,
           updated_by_user_id = EXCLUDED.updated_by_user_id,
           updated_at = EXCLUDED.updated_at
    RETURNING flags.editorial_workflow_v1_enabled
         INTO v_enabled;

    RETURN v_enabled;
END;
$function$;

REVOKE ALL ON FUNCTION ap.get_editorial_workflow_status() FROM PUBLIC;
REVOKE ALL ON FUNCTION ap.get_editorial_workflow_status() FROM anon;
REVOKE ALL ON FUNCTION ap.get_editorial_workflow_status() FROM service_role;
GRANT EXECUTE ON FUNCTION ap.get_editorial_workflow_status() TO authenticated;

REVOKE ALL ON FUNCTION ap.set_editorial_workflow_v1_enabled(boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION ap.set_editorial_workflow_v1_enabled(boolean) FROM anon;
REVOKE ALL ON FUNCTION ap.set_editorial_workflow_v1_enabled(boolean) FROM service_role;
GRANT EXECUTE ON FUNCTION ap.set_editorial_workflow_v1_enabled(boolean) TO authenticated;

COMMENT ON TABLE ap.editorial_feature_flags IS
    'Private R1 editorial rollout state. No row means editorial_workflow_v1_enabled = false.';
COMMENT ON FUNCTION ap.get_editorial_workflow_status() IS
    'Returns the authenticated caller operational tenant editorial workflow state; missing row is false.';
COMMENT ON FUNCTION ap.set_editorial_workflow_v1_enabled(boolean) IS
    'Tenant-derived administrative setter for the R1 editorial workflow flag.';

COMMIT;
