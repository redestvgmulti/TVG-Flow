-- Phase 0.5: keep canonical tenant provisioning functional under the
-- fail-closed search_path used by create_tenant_db.

CREATE OR REPLACE FUNCTION public.has_active_tenant_link(prof_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $function$
    SELECT EXISTS (
        SELECT 1
        FROM public.empresa_profissionais AS membership
        JOIN public.empresas AS tenant
          ON tenant.id = membership.empresa_id
        WHERE membership.profissional_id = prof_id
          AND membership.ativo IS TRUE
          AND tenant.empresa_tipo = 'tenant'
          AND tenant.ativo IS TRUE
    );
$function$;
CREATE OR REPLACE FUNCTION public.enforce_admin_role_requires_tenant()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
DECLARE
    has_tenant boolean;
BEGIN
    IF NEW.role = 'admin'
       AND (OLD.role IS NULL OR OLD.role <> 'admin') THEN
        SELECT public.has_active_tenant_link(NEW.id)
          INTO has_tenant;

        IF NOT has_tenant THEN
            RAISE EXCEPTION
                'TENANT_LINK_REQUIRED: Cannot promote % to admin without active tenant link',
                NEW.email
                USING HINT =
                    'Create active tenant link in empresa_profissionais before promoting to admin role';
        END IF;
    END IF;

    RETURN NEW;
END;
$function$;
