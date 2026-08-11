-- Safe deactivation flows preserve operational history while revoking access.
-- These functions are callable only by the service role through trusted Edge Functions.

CREATE OR REPLACE FUNCTION public.is_admin_safe()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.profissionais
        WHERE id = auth.uid()
          AND role = 'admin'
          AND ativo = true
    );
$$;

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.profissionais
        WHERE id = auth.uid()
          AND role = 'super_admin'
          AND ativo = true
    );
$$;

CREATE OR REPLACE FUNCTION public.is_admin_in_empresa(empresa_uuid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.empresa_profissionais ep
        INNER JOIN public.profissionais p ON p.id = ep.profissional_id
        WHERE ep.empresa_id = empresa_uuid
          AND p.id = auth.uid()
          AND p.role = 'admin'
          AND p.ativo = true
          AND ep.ativo = true
    );
$$;

CREATE OR REPLACE FUNCTION public.is_admin_of_tenant(target_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT target_tenant_id IS NOT NULL
       AND EXISTS (
            SELECT 1
            FROM public.empresa_profissionais ep
            INNER JOIN public.profissionais p ON p.id = ep.profissional_id
            WHERE ep.empresa_id = target_tenant_id
              AND ep.profissional_id = auth.uid()
              AND ep.ativo = true
              AND p.ativo = true
              AND p.role = 'admin'
       );
$$;

CREATE OR REPLACE FUNCTION public.has_tenant_admin(target_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT target_tenant_id IS NOT NULL
       AND EXISTS (
            SELECT 1
            FROM public.empresa_profissionais ep
            INNER JOIN public.profissionais p ON p.id = ep.profissional_id
            WHERE ep.empresa_id = target_tenant_id
              AND ep.ativo = true
              AND p.ativo = true
              AND p.role = 'admin'
       );
$$;

CREATE OR REPLACE FUNCTION public.enforce_admin_tenant_link()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    prof_role text;
    prof_email text;
    prof_active boolean;
    has_tenant boolean;
BEGIN
    SELECT role, email, ativo
      INTO prof_role, prof_email, prof_active
      FROM public.profissionais
     WHERE id = COALESCE(NEW.profissional_id, OLD.profissional_id);

    -- A disabled account must not retain tenant links or administrative access.
    IF prof_role IS NULL OR prof_role <> 'admin' OR prof_active IS NOT TRUE THEN
        RETURN COALESCE(NEW, OLD);
    END IF;

    IF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND NEW.ativo = false AND OLD.ativo = true) THEN
        SELECT EXISTS (
            SELECT 1
            FROM public.empresa_profissionais ep
            INNER JOIN public.empresas e ON e.id = ep.empresa_id
            WHERE ep.profissional_id = OLD.profissional_id
              AND ep.ativo = true
              AND e.empresa_tipo = 'tenant'
              AND e.ativo = true
              AND ep.id <> OLD.id
        ) INTO has_tenant;

        IF NOT has_tenant THEN
            RAISE EXCEPTION 'TENANT_LINK_REQUIRED: Cannot remove last active tenant link for admin % (%).',
                prof_email, OLD.profissional_id
                USING HINT = 'Deactivate the account before removing its final tenant link.';
        END IF;
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION public.deactivate_professional(
    p_actor_id uuid,
    p_professional_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    actor_role text;
    actor_active boolean;
    target_role text;
    target_active boolean;
    shares_tenant boolean;
BEGIN
    IF auth.role() <> 'service_role' THEN
        RAISE EXCEPTION 'FORBIDDEN: This operation is restricted to the server.';
    END IF;

    IF p_actor_id IS NULL OR p_professional_id IS NULL THEN
        RAISE EXCEPTION 'INVALID_REQUEST: actor and professional are required.';
    END IF;

    IF p_actor_id = p_professional_id THEN
        RAISE EXCEPTION 'SELF_DEACTIVATION_FORBIDDEN: You cannot deactivate your own account.';
    END IF;

    SELECT role, ativo INTO actor_role, actor_active
      FROM public.profissionais WHERE id = p_actor_id;

    IF NOT FOUND OR actor_active IS NOT TRUE OR actor_role NOT IN ('admin', 'super_admin') THEN
        RAISE EXCEPTION 'FORBIDDEN: Only active administrators can deactivate professionals.';
    END IF;

    SELECT role, ativo INTO target_role, target_active
      FROM public.profissionais WHERE id = p_professional_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'PROFESSIONAL_NOT_FOUND: Professional was not found.';
    END IF;

    IF target_role = 'super_admin' THEN
        RAISE EXCEPTION 'SUPER_ADMIN_PROTECTED: A super administrator cannot be deactivated here.';
    END IF;

    IF actor_role = 'admin' THEN
        IF target_role <> 'staff' THEN
            RAISE EXCEPTION 'ROLE_SCOPE_FORBIDDEN: An admin may deactivate staff only.';
        END IF;

        SELECT EXISTS (
            SELECT 1
            FROM public.empresa_profissionais target_link
            INNER JOIN public.empresas target_company ON target_company.id = target_link.empresa_id
            WHERE target_link.profissional_id = p_professional_id
              AND target_link.ativo = true
              AND (
                  target_company.id IN (
                      SELECT actor_link.empresa_id
                      FROM public.empresa_profissionais actor_link
                      INNER JOIN public.empresas actor_company ON actor_company.id = actor_link.empresa_id
                      WHERE actor_link.profissional_id = p_actor_id
                        AND actor_link.ativo = true
                        AND actor_company.empresa_tipo = 'tenant'
                        AND actor_company.ativo = true
                  )
                  OR target_company.tenant_id IN (
                      SELECT actor_link.empresa_id
                      FROM public.empresa_profissionais actor_link
                      INNER JOIN public.empresas actor_company ON actor_company.id = actor_link.empresa_id
                      WHERE actor_link.profissional_id = p_actor_id
                        AND actor_link.ativo = true
                        AND actor_company.empresa_tipo = 'tenant'
                        AND actor_company.ativo = true
                  )
              )
        ) INTO shares_tenant;

        IF NOT shares_tenant THEN
            RAISE EXCEPTION 'TENANT_SCOPE_FORBIDDEN: This professional is outside your tenant.';
        END IF;
    END IF;

    IF target_active IS TRUE THEN
        UPDATE public.profissionais
           SET ativo = false
         WHERE id = p_professional_id;

        -- Preserve tasks and audit history, but remove all operational membership.
        DELETE FROM public.cliente_profissionais
         WHERE profissional_id = p_professional_id;

        DELETE FROM public.empresa_profissionais
         WHERE profissional_id = p_professional_id;
    END IF;

    RETURN jsonb_build_object(
        'status', CASE WHEN target_active IS TRUE THEN 'deactivated' ELSE 'already_deactivated' END,
        'professional_id', p_professional_id
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.deactivate_operational_company(
    p_actor_id uuid,
    p_company_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    actor_role text;
    actor_active boolean;
    company_type text;
    company_tenant_id uuid;
    company_active boolean;
    manages_tenant boolean;
BEGIN
    IF auth.role() <> 'service_role' THEN
        RAISE EXCEPTION 'FORBIDDEN: This operation is restricted to the server.';
    END IF;

    IF p_actor_id IS NULL OR p_company_id IS NULL THEN
        RAISE EXCEPTION 'INVALID_REQUEST: actor and company are required.';
    END IF;

    SELECT role, ativo INTO actor_role, actor_active
      FROM public.profissionais WHERE id = p_actor_id;

    IF NOT FOUND OR actor_active IS NOT TRUE OR actor_role <> 'admin' THEN
        RAISE EXCEPTION 'FORBIDDEN: Only active tenant administrators can deactivate companies.';
    END IF;

    SELECT empresa_tipo, tenant_id, ativo
      INTO company_type, company_tenant_id, company_active
      FROM public.empresas
     WHERE id = p_company_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'COMPANY_NOT_FOUND: Company was not found.';
    END IF;

    IF company_type <> 'operacional' THEN
        RAISE EXCEPTION 'COMPANY_TYPE_FORBIDDEN: Tenant companies cannot be deactivated from this area.';
    END IF;

    SELECT EXISTS (
        SELECT 1
        FROM public.empresa_profissionais ep
        INNER JOIN public.empresas e ON e.id = ep.empresa_id
        WHERE ep.profissional_id = p_actor_id
          AND ep.empresa_id = company_tenant_id
          AND ep.ativo = true
          AND e.empresa_tipo = 'tenant'
          AND e.ativo = true
    ) INTO manages_tenant;

    IF NOT manages_tenant THEN
        RAISE EXCEPTION 'TENANT_SCOPE_FORBIDDEN: This company is outside your tenant.';
    END IF;

    IF company_active IS TRUE THEN
        UPDATE public.empresas
           SET ativo = false
         WHERE id = p_company_id;

        -- The company is no longer an operational context for any professional.
        DELETE FROM public.empresa_profissionais
         WHERE empresa_id = p_company_id;
    END IF;

    RETURN jsonb_build_object(
        'status', CASE WHEN company_active IS TRUE THEN 'deactivated' ELSE 'already_deactivated' END,
        'company_id', p_company_id
    );
END;
$$;

REVOKE ALL ON FUNCTION public.deactivate_professional(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.deactivate_operational_company(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.deactivate_professional(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.deactivate_operational_company(uuid, uuid) TO service_role;
