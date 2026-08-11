-- Existing employee accounts use the legacy `profissional` role. Treat it as
-- an employee role alongside `staff`, while keeping tenant and privilege
-- boundaries enforced by the original deactivation function.
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
        IF target_role NOT IN ('staff', 'profissional') THEN
            RAISE EXCEPTION 'ROLE_SCOPE_FORBIDDEN: An admin may deactivate staff and professionals only.';
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
