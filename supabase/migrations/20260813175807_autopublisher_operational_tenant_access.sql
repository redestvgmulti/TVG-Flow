-- Let AutoPublisher operators use the same active tenant relationship that
-- public.get_agencia_cliente_id already resolves, without widening write
-- access to configuration records or allowing cross-tenant selection.
CREATE OR REPLACE FUNCTION ap.get_operational_cliente_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, ap, pg_temp
AS $$
    SELECT DISTINCT candidate.cliente_id
    FROM (
        SELECT membership.cliente_id
        FROM public.cliente_profissionais AS membership
        WHERE membership.profissional_id = auth.uid()
          AND membership.ativo IS TRUE

        UNION

        SELECT client.id
        FROM public.empresa_profissionais AS membership
        JOIN public.empresas AS tenant_empresa
          ON tenant_empresa.id = membership.empresa_id
        JOIN public.clientes AS client
          ON client.empresa_id = tenant_empresa.id
          OR client.empresa_id IN (
              SELECT empresa.id
              FROM public.empresas AS empresa
              WHERE empresa.tenant_id = tenant_empresa.id
          )
        JOIN public.empresas AS client_empresa
          ON client_empresa.id = client.empresa_id
        WHERE membership.profissional_id = auth.uid()
          AND membership.ativo IS TRUE
          AND tenant_empresa.ativo IS TRUE
          AND tenant_empresa.empresa_tipo = 'tenant'
          AND client.ativo IS TRUE
          AND client_empresa.ativo IS TRUE
    ) AS candidate(cliente_id);
$$;

REVOKE ALL ON FUNCTION ap.get_operational_cliente_ids() FROM PUBLIC;
REVOKE ALL ON FUNCTION ap.get_operational_cliente_ids() FROM anon;
GRANT EXECUTE ON FUNCTION ap.get_operational_cliente_ids() TO authenticated, service_role;

-- The existing direct-client policies retain all administration writes. These
-- additive SELECT policies are deliberately limited to the runtime records an
-- operator needs to compose a matter for an authorized operational client.
CREATE POLICY visual_titles_select_operational_client
    ON ap.visual_titles
    FOR SELECT TO authenticated
    USING (cliente_id IN (SELECT ap.get_operational_cliente_ids()));

CREATE POLICY visual_title_groups_select_operational_client
    ON ap.visual_title_groups
    FOR SELECT TO authenticated
    USING (cliente_id IN (SELECT ap.get_operational_cliente_ids()));

CREATE POLICY master_render_controls_select_operational_client
    ON ap.master_render_controls
    FOR SELECT TO authenticated
    USING (cliente_id IN (SELECT ap.get_operational_cliente_ids()));

CREATE POLICY master_render_configs_select_operational_client
    ON ap.master_render_configs
    FOR SELECT TO authenticated
    USING (cliente_id IN (SELECT ap.get_operational_cliente_ids()));

CREATE POLICY render_sponsors_select_operational_client
    ON ap.render_sponsors
    FOR SELECT TO authenticated
    USING (cliente_id IN (SELECT ap.get_operational_cliente_ids()));

CREATE POLICY render_sponsor_scope_memberships_select_operational_client
    ON ap.render_sponsor_scope_memberships
    FOR SELECT TO authenticated
    USING (cliente_id IN (SELECT ap.get_operational_cliente_ids()));

CREATE POLICY territorial_composer_features_select_operational_client
    ON ap.territorial_composer_features
    FOR SELECT TO authenticated
    USING (cliente_id IN (SELECT ap.get_operational_cliente_ids()));

-- Catalog and creation RPCs validate the caller themselves; this redefinition
-- accepts the same operational relationship and continues to require the
-- feature flag for the requested client.
CREATE OR REPLACE FUNCTION ap.require_territorial_composer_access(
    p_cliente_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, ap, public, pg_temp
AS $$
DECLARE
    v_user_id uuid := auth.uid();
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '28000';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM ap.get_operational_cliente_ids() AS allowed(cliente_id)
        WHERE allowed.cliente_id = p_cliente_id
    ) THEN
        RAISE EXCEPTION 'TENANT_FORBIDDEN' USING ERRCODE = '42501';
    END IF;

    IF NOT COALESCE((
        SELECT feature.enabled
        FROM ap.territorial_composer_features AS feature
        WHERE feature.cliente_id = p_cliente_id
    ), false) THEN
        RAISE EXCEPTION 'TERRITORIAL_COMPOSER_DISABLED' USING ERRCODE = '42501';
    END IF;

    RETURN v_user_id;
END;
$$;

REVOKE ALL ON FUNCTION ap.require_territorial_composer_access(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION ap.require_territorial_composer_access(uuid) TO authenticated, service_role;
