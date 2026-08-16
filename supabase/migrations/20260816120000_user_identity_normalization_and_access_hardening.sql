BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS private.user_access_normalization_snapshots (
    migration_key text PRIMARY KEY,
    captured_at timestamptz NOT NULL DEFAULT now(),
    profiles jsonb NOT NULL,
    memberships jsonb NOT NULL,
    auth_state jsonb NOT NULL
);

REVOKE ALL ON TABLE private.user_access_normalization_snapshots FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE private.user_access_normalization_snapshots TO service_role;

-- Fail closed if production changed after the read-only audit. Nothing below
-- runs unless the full Auth/profile/tenant baseline is still exactly known.
DO $$
DECLARE
    v_count integer;
BEGIN
    SELECT count(*) INTO v_count FROM auth.users WHERE deleted_at IS NULL;
    IF v_count <> 21 THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: expected 21 non-deleted Auth users, found %', v_count;
    END IF;

    SELECT count(*) INTO v_count FROM public.profissionais;
    IF v_count <> 21 THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: expected 21 profiles, found %', v_count;
    END IF;

    SELECT count(*) INTO v_count
    FROM auth.users u
    FULL JOIN public.profissionais p ON p.id = u.id
    WHERE u.deleted_at IS NULL
      AND (u.id IS NULL OR p.id IS NULL OR lower(u.email) <> lower(p.email));
    IF v_count <> 0 THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: Auth/profile identity mismatch count is %', v_count;
    END IF;

    SELECT count(*) INTO v_count FROM public.profissionais WHERE ativo = true;
    IF v_count <> 17 THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: expected 17 active profiles, found %', v_count;
    END IF;

    SELECT count(*) INTO v_count FROM public.profissionais WHERE ativo = false;
    IF v_count <> 4 THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: expected 4 inactive profiles, found %', v_count;
    END IF;

    SELECT count(*) INTO v_count FROM public.profissionais WHERE role = 'super_admin';
    IF v_count <> 1 THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: expected one super_admin, found %', v_count;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.profissionais
        WHERE role = 'super_admin'
          AND ativo = true
          AND lower(email) = 'geovanepanini@icloud.com'
    ) THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: protected super administrator identity changed';
    END IF;

    SELECT count(*) INTO v_count FROM public.profissionais WHERE role = 'admin';
    IF v_count <> 3 THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: expected 3 admins, found %', v_count;
    END IF;

    SELECT count(*) INTO v_count FROM public.profissionais WHERE role = 'staff';
    IF v_count <> 3 THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: expected 3 canonical staff before normalization, found %', v_count;
    END IF;

    SELECT count(*) INTO v_count FROM public.profissionais WHERE role = 'profissional';
    IF v_count <> 14 THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: expected 14 legacy professionals, found %', v_count;
    END IF;

    SELECT count(*) INTO v_count
    FROM public.profissionais p
    WHERE p.ativo = true
      AND p.role <> 'super_admin'
      AND 1 <> (
          SELECT count(*)
          FROM public.empresa_profissionais ep
          JOIN public.empresas e ON e.id = ep.empresa_id
          WHERE ep.profissional_id = p.id
            AND ep.ativo = true
            AND e.ativo = true
            AND e.empresa_tipo = 'tenant'
      );
    IF v_count <> 0 THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: % active tenant users lack exactly one active tenant', v_count;
    END IF;

    SELECT count(*) INTO v_count
    FROM public.empresa_profissionais ep
    JOIN public.profissionais p ON p.id = ep.profissional_id
    WHERE p.role = 'super_admin' AND ep.ativo = true;
    IF v_count <> 0 THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: super administrator has % active memberships', v_count;
    END IF;

    SELECT count(*) INTO v_count
    FROM public.empresa_profissionais ep
    JOIN public.empresas e ON e.id = ep.empresa_id
    WHERE ep.ativo = true AND e.ativo = false;
    IF v_count <> 44 THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: expected 44 stale active links, found %', v_count;
    END IF;

    SELECT count(*) INTO v_count
    FROM public.profissionais p
    JOIN auth.users u ON u.id = p.id
    WHERE p.ativo = false
      AND (u.banned_until IS NULL OR u.banned_until <= now());
    IF v_count <> 0 THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: % inactive profiles are not Auth-banned', v_count;
    END IF;

    IF EXISTS (
        SELECT 1 FROM private.user_access_normalization_snapshots
        WHERE migration_key = '20260816120000'
    ) THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: normalization snapshot already exists';
    END IF;
END;
$$;

INSERT INTO private.user_access_normalization_snapshots (
    migration_key,
    profiles,
    memberships,
    auth_state
)
SELECT
    '20260816120000',
    (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM public.profissionais p),
    (SELECT jsonb_agg(to_jsonb(ep) ORDER BY ep.id) FROM public.empresa_profissionais ep),
    (
        SELECT jsonb_agg(
            jsonb_build_object(
                'id', u.id,
                'email', u.email,
                'banned_until', u.banned_until,
                'deleted_at', u.deleted_at,
                'email_confirmed_at', u.email_confirmed_at,
                'last_sign_in_at', u.last_sign_in_at
            ) ORDER BY u.id
        )
        FROM auth.users u
        WHERE u.deleted_at IS NULL
    );

-- Remove automatic first-tenant assignment. Tenant selection must always be
-- explicit and authorized by the server-side provisioning contract.
DROP TRIGGER IF EXISTS trg_bootstrap_admin_tenant ON public.profissionais;
DROP FUNCTION IF EXISTS public.bootstrap_admin_tenant_link();
DROP FUNCTION IF EXISTS public.bootstrap_admin_tenant_link_after();

DO $$
DECLARE
    v_updated integer;
BEGIN
    UPDATE public.profissionais
       SET role = 'staff'
     WHERE role = 'profissional';
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated <> 14 THEN
        RAISE EXCEPTION 'NORMALIZATION_FAILED: expected to normalize 14 profiles, updated %', v_updated;
    END IF;
END;
$$;

-- Membership.role mirrors the canonical profile role and is never an
-- independent source of authority. Operational funcao/cargo history remains
-- untouched; only tenant labels are canonicalized.
UPDATE public.empresa_profissionais ep
   SET role = p.role
  FROM public.profissionais p
 WHERE p.id = ep.profissional_id
   AND ep.role IS DISTINCT FROM p.role;

UPDATE public.empresa_profissionais ep
   SET funcao = CASE WHEN p.role = 'admin' THEN 'Admin' ELSE 'Staff' END
  FROM public.profissionais p, public.empresas e
 WHERE p.id = ep.profissional_id
   AND e.id = ep.empresa_id
   AND e.empresa_tipo = 'tenant'
   AND ep.funcao IS DISTINCT FROM CASE WHEN p.role = 'admin' THEN 'Admin' ELSE 'Staff' END;

-- Reversible soft deactivation only. No relationship or history is deleted.
UPDATE public.empresa_profissionais ep
   SET ativo = false
  FROM public.empresas e
 WHERE e.id = ep.empresa_id
   AND e.ativo = false
   AND ep.ativo = true;

ALTER TABLE public.profissionais DROP CONSTRAINT IF EXISTS profissionais_role_check;
ALTER TABLE public.profissionais
    ADD CONSTRAINT profissionais_role_check
    CHECK (role IN ('super_admin', 'admin', 'staff'));

ALTER TABLE public.empresa_profissionais DROP CONSTRAINT IF EXISTS empresa_profissionais_role_check;
ALTER TABLE public.empresa_profissionais
    ADD CONSTRAINT empresa_profissionais_role_check
    CHECK (role IS NULL OR role IN ('super_admin', 'admin', 'staff'));

CREATE OR REPLACE FUNCTION public.current_active_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT (array_agg(DISTINCT ep.empresa_id))[1]
    FROM public.empresa_profissionais ep
    JOIN public.empresas e ON e.id = ep.empresa_id
    JOIN public.profissionais p ON p.id = ep.profissional_id
    WHERE ep.profissional_id = auth.uid()
      AND ep.ativo = true
      AND e.ativo = true
      AND e.empresa_tipo = 'tenant'
      AND p.ativo = true
      AND p.role IN ('admin', 'staff')
    HAVING count(DISTINCT ep.empresa_id) = 1;
$$;

CREATE OR REPLACE FUNCTION public.is_active_super_admin_identity()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.profissionais p
        WHERE p.id = auth.uid()
          AND p.ativo = true
          AND p.role = 'super_admin'
    );
$$;

CREATE OR REPLACE FUNCTION public.can_view_professional(p_target_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.profissionais actor
        JOIN public.profissionais target ON target.id = p_target_id
        WHERE actor.id = auth.uid()
          AND actor.ativo = true
          AND (
              actor.role = 'super_admin'
              OR (
                  target.ativo = true
                  AND actor.role IN ('admin', 'staff')
                  AND EXISTS (
                      SELECT 1
                      FROM public.empresa_profissionais actor_link
                      JOIN public.empresas tenant ON tenant.id = actor_link.empresa_id
                      JOIN public.empresa_profissionais target_link
                        ON target_link.empresa_id = actor_link.empresa_id
                      WHERE actor_link.profissional_id = actor.id
                        AND target_link.profissional_id = target.id
                        AND actor_link.ativo = true
                        AND target_link.ativo = true
                        AND tenant.ativo = true
                        AND tenant.empresa_tipo = 'tenant'
                  )
              )
          )
    );
$$;

CREATE OR REPLACE FUNCTION public.can_view_company_membership(
    p_company_id uuid,
    p_professional_id uuid,
    p_link_active boolean
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.profissionais actor
        JOIN public.empresas company ON company.id = p_company_id
        JOIN public.profissionais target ON target.id = p_professional_id
        WHERE actor.id = auth.uid()
          AND actor.ativo = true
          AND (
              actor.role = 'super_admin'
              OR (
                  target.ativo = true
                  AND public.current_active_tenant_id() IS NOT NULL
                  AND (
                      company.id = public.current_active_tenant_id()
                      OR company.tenant_id = public.current_active_tenant_id()
                  )
                  AND company.ativo = true
                  AND EXISTS (
                      SELECT 1
                      FROM public.empresa_profissionais target_tenant_link
                      WHERE target_tenant_link.profissional_id = target.id
                        AND target_tenant_link.empresa_id = public.current_active_tenant_id()
                        AND target_tenant_link.ativo = true
                  )
                  AND (actor.role = 'admin' OR p_link_active = true)
              )
          )
    );
$$;

CREATE OR REPLACE FUNCTION public.can_manage_operational_membership(
    p_company_id uuid,
    p_professional_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.profissionais actor
        JOIN public.empresas company ON company.id = p_company_id
        JOIN public.profissionais target ON target.id = p_professional_id
        WHERE actor.id = auth.uid()
          AND actor.ativo = true
          AND actor.role = 'admin'
          AND target.ativo = true
          AND company.ativo = true
          AND company.empresa_tipo = 'operacional'
          AND company.tenant_id = public.current_active_tenant_id()
          AND EXISTS (
              SELECT 1
              FROM public.empresa_profissionais target_tenant_link
              WHERE target_tenant_link.profissional_id = target.id
                AND target_tenant_link.empresa_id = public.current_active_tenant_id()
                AND target_tenant_link.ativo = true
          )
    );
$$;

CREATE OR REPLACE FUNCTION public.get_my_company_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT ep.empresa_id
    FROM public.empresa_profissionais ep
    JOIN public.empresas e ON e.id = ep.empresa_id
    JOIN public.profissionais p ON p.id = ep.profissional_id
    WHERE ep.profissional_id = auth.uid()
      AND ep.ativo = true
      AND e.ativo = true
      AND p.ativo = true;
$$;

CREATE OR REPLACE FUNCTION public.get_visible_colleagues()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT target_link.profissional_id
    FROM public.empresa_profissionais target_link
    JOIN public.empresas tenant ON tenant.id = target_link.empresa_id
    JOIN public.profissionais target ON target.id = target_link.profissional_id
    WHERE target_link.empresa_id = public.current_active_tenant_id()
      AND target_link.ativo = true
      AND tenant.ativo = true
      AND tenant.empresa_tipo = 'tenant'
      AND target.ativo = true;
$$;

CREATE OR REPLACE FUNCTION public.get_current_identity()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_prof public.profissionais%ROWTYPE;
    v_tenant_count integer := 0;
    v_tenant_id uuid;
    v_access_ready boolean := false;
    v_access_reason text;
BEGIN
    SELECT * INTO v_prof
    FROM public.profissionais
    WHERE id = auth.uid();

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'has_profile', false,
            'role', null,
            'id', null,
            'nome', null,
            'ativo', false,
            'access_ready', false,
            'access_reason', 'PROFILE_NOT_FOUND'
        );
    END IF;

    IF v_prof.role <> 'super_admin' THEN
        SELECT count(DISTINCT ep.empresa_id), (array_agg(DISTINCT ep.empresa_id))[1]
          INTO v_tenant_count, v_tenant_id
        FROM public.empresa_profissionais ep
        JOIN public.empresas e ON e.id = ep.empresa_id
        WHERE ep.profissional_id = v_prof.id
          AND ep.ativo = true
          AND e.ativo = true
          AND e.empresa_tipo = 'tenant';
    END IF;

    v_access_ready := v_prof.ativo = true
        AND (
            (v_prof.role = 'super_admin' AND v_tenant_count = 0)
            OR (v_prof.role IN ('admin', 'staff') AND v_tenant_count = 1)
        );

    v_access_reason := CASE
        WHEN v_prof.ativo IS NOT TRUE THEN 'PROFILE_INACTIVE'
        WHEN v_prof.role NOT IN ('super_admin', 'admin', 'staff') THEN 'INVALID_ROLE'
        WHEN v_prof.role = 'super_admin' AND v_tenant_count <> 0 THEN 'SUPER_ADMIN_HAS_TENANT'
        WHEN v_prof.role IN ('admin', 'staff') AND v_tenant_count <> 1 THEN 'INVALID_TENANT_CONTEXT'
        ELSE 'READY'
    END;

    RETURN jsonb_build_object(
        'has_profile', true,
        'id', v_prof.id,
        'nome', v_prof.nome,
        'email', v_prof.email,
        'role', v_prof.role,
        'ativo', v_prof.ativo,
        'tenant_id', v_tenant_id,
        'tenant_count', v_tenant_count,
        'access_ready', v_access_ready,
        'access_reason', v_access_reason
    );
END;
$$;

-- Replace all historical policies on these identity tables with one explicit,
-- non-recursive tenant contract.
DO $$
DECLARE
    v_policy record;
BEGIN
    FOR v_policy IN
        SELECT schemaname, tablename, policyname
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename IN ('profissionais', 'empresa_profissionais')
    LOOP
        EXECUTE format('DROP POLICY %I ON %I.%I', v_policy.policyname, v_policy.schemaname, v_policy.tablename);
    END LOOP;
END;
$$;

CREATE POLICY profissionais_tenant_select
ON public.profissionais
FOR SELECT TO authenticated
USING (public.can_view_professional(id));

CREATE POLICY empresa_profissionais_tenant_select
ON public.empresa_profissionais
FOR SELECT TO authenticated
USING (public.can_view_company_membership(empresa_id, profissional_id, ativo));

CREATE POLICY empresa_profissionais_tenant_insert
ON public.empresa_profissionais
FOR INSERT TO authenticated
WITH CHECK (public.can_manage_operational_membership(empresa_id, profissional_id));

CREATE POLICY empresa_profissionais_tenant_update
ON public.empresa_profissionais
FOR UPDATE TO authenticated
USING (public.can_manage_operational_membership(empresa_id, profissional_id))
WITH CHECK (public.can_manage_operational_membership(empresa_id, profissional_id));

CREATE POLICY empresa_profissionais_tenant_delete
ON public.empresa_profissionais
FOR DELETE TO authenticated
USING (public.can_manage_operational_membership(empresa_id, profissional_id));

REVOKE ALL ON TABLE public.profissionais FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.profissionais FROM authenticated;
GRANT SELECT ON TABLE public.profissionais TO authenticated;

REVOKE ALL ON TABLE public.empresa_profissionais FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.empresa_profissionais TO authenticated;

CREATE OR REPLACE FUNCTION public.protect_professional_sensitive_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF auth.role() = 'service_role' OR session_user IN ('postgres', 'supabase_admin') THEN
        RETURN NEW;
    END IF;

    IF NEW.role IS DISTINCT FROM OLD.role
       OR NEW.ativo IS DISTINCT FROM OLD.ativo
       OR lower(NEW.email) IS DISTINCT FROM lower(OLD.email) THEN
        RAISE EXCEPTION 'FORBIDDEN: role, status and email are server-managed fields';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_professional_sensitive_fields ON public.profissionais;
CREATE TRIGGER trg_protect_professional_sensitive_fields
BEFORE UPDATE ON public.profissionais
FOR EACH ROW EXECUTE FUNCTION public.protect_professional_sensitive_fields();

CREATE OR REPLACE FUNCTION public.normalize_membership_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_role text;
BEGIN
    SELECT p.role INTO v_role
    FROM public.profissionais p
    WHERE p.id = NEW.profissional_id;

    IF v_role IS NULL THEN
        RAISE EXCEPTION 'PROFESSIONAL_NOT_FOUND';
    END IF;

    NEW.role := v_role;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_normalize_membership_role ON public.empresa_profissionais;
CREATE TRIGGER trg_normalize_membership_role
BEFORE INSERT OR UPDATE OF profissional_id, role ON public.empresa_profissionais
FOR EACH ROW EXECUTE FUNCTION public.normalize_membership_role();

CREATE OR REPLACE FUNCTION public.enforce_single_active_tenant_membership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_is_tenant boolean;
BEGIN
    SELECT e.empresa_tipo = 'tenant' AND e.ativo = true
      INTO v_is_tenant
    FROM public.empresas e
    WHERE e.id = NEW.empresa_id;

    IF NEW.ativo = true AND v_is_tenant = true AND EXISTS (
        SELECT 1
        FROM public.empresa_profissionais ep
        JOIN public.empresas e ON e.id = ep.empresa_id
        WHERE ep.profissional_id = NEW.profissional_id
          AND ep.ativo = true
          AND e.ativo = true
          AND e.empresa_tipo = 'tenant'
          AND ep.id <> NEW.id
    ) THEN
        RAISE EXCEPTION 'MULTIPLE_ACTIVE_TENANTS_FORBIDDEN';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_single_active_tenant_membership ON public.empresa_profissionais;
CREATE TRIGGER trg_enforce_single_active_tenant_membership
BEFORE INSERT OR UPDATE OF empresa_id, profissional_id, ativo ON public.empresa_profissionais
FOR EACH ROW EXECUTE FUNCTION public.enforce_single_active_tenant_membership();

CREATE OR REPLACE FUNCTION public.enforce_admin_tenant_link()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_role text;
    v_active boolean;
    v_email text;
    v_has_other_tenant boolean;
BEGIN
    SELECT p.role, p.ativo, p.email
      INTO v_role, v_active, v_email
    FROM public.profissionais p
    WHERE p.id = COALESCE(NEW.profissional_id, OLD.profissional_id);

    IF v_role <> 'admin' OR v_active IS NOT TRUE THEN
        RETURN COALESCE(NEW, OLD);
    END IF;

    IF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND NEW.ativo = false AND OLD.ativo = true) THEN
        SELECT EXISTS (
            SELECT 1
            FROM public.empresa_profissionais ep
            JOIN public.empresas e ON e.id = ep.empresa_id
            WHERE ep.profissional_id = OLD.profissional_id
              AND ep.ativo = true
              AND e.empresa_tipo = 'tenant'
              AND e.ativo = true
              AND ep.id <> OLD.id
        ) INTO v_has_other_tenant;

        IF NOT v_has_other_tenant THEN
            RAISE EXCEPTION 'TENANT_LINK_REQUIRED: cannot remove the last tenant for active admin %', v_email;
        END IF;
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_profissional_on_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    INSERT INTO public.profissionais (id, nome, email, role, ativo)
    VALUES (
        NEW.id,
        COALESCE(
            NULLIF(NEW.raw_user_meta_data->>'full_name', ''),
            NULLIF(NEW.raw_user_meta_data->>'nome', ''),
            NULLIF(NEW.raw_user_meta_data->>'name', ''),
            NULLIF(split_part(COALESCE(NEW.email, ''), '@', 1), ''),
            'Usuário'
        ),
        lower(NEW.email),
        'staff',
        false
    )
    ON CONFLICT (id) DO NOTHING;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    INSERT INTO public.profissionais (id, nome, email, role, ativo)
    VALUES (
        NEW.id,
        COALESCE(
            NULLIF(NEW.raw_user_meta_data->>'full_name', ''),
            NULLIF(NEW.raw_user_meta_data->>'nome', ''),
            NULLIF(NEW.raw_user_meta_data->>'name', ''),
            NULLIF(split_part(COALESCE(NEW.email, ''), '@', 1), ''),
            'Usuário'
        ),
        lower(NEW.email),
        'staff',
        false
    )
    ON CONFLICT (id) DO NOTHING;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.provision_professional_identity(
    p_actor_id uuid,
    p_user_id uuid,
    p_email text,
    p_name text,
    p_area_id uuid,
    p_role text,
    p_tenant_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_actor_role text;
    v_actor_active boolean;
    v_actor_tenant uuid;
    v_existing_role text;
    v_tenant_count integer;
BEGIN
    IF auth.role() <> 'service_role' THEN
        RAISE EXCEPTION 'FORBIDDEN: server-only operation';
    END IF;

    IF p_role NOT IN ('admin', 'staff') THEN
        RAISE EXCEPTION 'INVALID_ROLE';
    END IF;
    IF p_user_id IS NULL OR p_actor_id IS NULL OR p_tenant_id IS NULL
       OR nullif(trim(p_name), '') IS NULL OR nullif(trim(p_email), '') IS NULL THEN
        RAISE EXCEPTION 'INVALID_REQUEST';
    END IF;

    SELECT p.role, p.ativo INTO v_actor_role, v_actor_active
    FROM public.profissionais p
    WHERE p.id = p_actor_id;

    IF NOT FOUND OR v_actor_active IS NOT TRUE OR v_actor_role NOT IN ('admin', 'super_admin') THEN
        RAISE EXCEPTION 'FORBIDDEN: active administrator required';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM auth.users u
        WHERE u.id = p_user_id
          AND u.deleted_at IS NULL
          AND lower(u.email) = lower(trim(p_email))
    ) THEN
        RAISE EXCEPTION 'AUTH_PROFILE_MISMATCH';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.empresas e
        WHERE e.id = p_tenant_id
          AND e.empresa_tipo = 'tenant'
          AND e.ativo = true
    ) THEN
        RAISE EXCEPTION 'ACTIVE_TENANT_NOT_FOUND';
    END IF;

    IF v_actor_role = 'admin' THEN
        IF p_role <> 'staff' THEN
            RAISE EXCEPTION 'ROLE_SCOPE_FORBIDDEN';
        END IF;

        SELECT (array_agg(DISTINCT ep.empresa_id))[1] INTO v_actor_tenant
        FROM public.empresa_profissionais ep
        JOIN public.empresas e ON e.id = ep.empresa_id
        WHERE ep.profissional_id = p_actor_id
          AND ep.ativo = true
          AND e.ativo = true
          AND e.empresa_tipo = 'tenant'
        HAVING count(DISTINCT ep.empresa_id) = 1;

        IF v_actor_tenant IS DISTINCT FROM p_tenant_id THEN
            RAISE EXCEPTION 'TENANT_SCOPE_FORBIDDEN';
        END IF;
    END IF;

    SELECT p.role INTO v_existing_role
    FROM public.profissionais p
    WHERE p.id = p_user_id;

    IF v_existing_role = 'super_admin' THEN
        RAISE EXCEPTION 'SUPER_ADMIN_PROTECTED';
    END IF;
    IF v_actor_role = 'admin' AND v_existing_role = 'admin' THEN
        RAISE EXCEPTION 'ROLE_SCOPE_FORBIDDEN';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.empresa_profissionais ep
        JOIN public.empresas e ON e.id = ep.empresa_id
        WHERE ep.profissional_id = p_user_id
          AND ep.ativo = true
          AND e.ativo = true
          AND e.empresa_tipo = 'tenant'
          AND ep.empresa_id <> p_tenant_id
    ) THEN
        RAISE EXCEPTION 'TENANT_REASSIGNMENT_FORBIDDEN';
    END IF;

    INSERT INTO public.profissionais (id, nome, email, area_id, role, ativo)
    VALUES (p_user_id, trim(p_name), lower(trim(p_email)), p_area_id, 'staff', false)
    ON CONFLICT (id) DO UPDATE
       SET nome = EXCLUDED.nome,
           email = EXCLUDED.email,
           area_id = EXCLUDED.area_id;

    INSERT INTO public.empresa_profissionais (
        empresa_id, profissional_id, funcao, role, ativo
    ) VALUES (
        p_tenant_id, p_user_id,
        CASE WHEN p_role = 'admin' THEN 'Admin' ELSE 'Staff' END,
        'staff', true
    )
    ON CONFLICT (empresa_id, profissional_id) DO UPDATE
       SET ativo = true,
           funcao = EXCLUDED.funcao;

    UPDATE public.profissionais
       SET nome = trim(p_name),
           email = lower(trim(p_email)),
           area_id = p_area_id,
           role = p_role,
           ativo = true
     WHERE id = p_user_id;

    UPDATE public.empresa_profissionais
       SET role = p_role,
           funcao = CASE WHEN p_role = 'admin' THEN 'Admin' ELSE 'Staff' END,
           ativo = true
     WHERE empresa_id = p_tenant_id
       AND profissional_id = p_user_id;

    SELECT count(DISTINCT ep.empresa_id) INTO v_tenant_count
    FROM public.empresa_profissionais ep
    JOIN public.empresas e ON e.id = ep.empresa_id
    WHERE ep.profissional_id = p_user_id
      AND ep.ativo = true
      AND e.ativo = true
      AND e.empresa_tipo = 'tenant';

    IF v_tenant_count <> 1 THEN
        RAISE EXCEPTION 'PROVISIONING_POSTCONDITION_FAILED';
    END IF;

    RETURN jsonb_build_object(
        'id', p_user_id,
        'role', p_role,
        'tenant_id', p_tenant_id,
        'active', true
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.update_professional_identity(
    p_actor_id uuid,
    p_professional_id uuid,
    p_updates jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_actor_role text;
    v_actor_active boolean;
    v_target_role text;
    v_target_active boolean;
    v_new_role text;
    v_shared_tenant uuid;
BEGIN
    IF auth.role() <> 'service_role' THEN
        RAISE EXCEPTION 'FORBIDDEN: server-only operation';
    END IF;
    IF p_updates IS NULL OR jsonb_typeof(p_updates) <> 'object' THEN
        RAISE EXCEPTION 'INVALID_UPDATE_PAYLOAD';
    END IF;
    IF EXISTS (
        SELECT 1 FROM jsonb_object_keys(p_updates) AS k(key)
        WHERE key NOT IN ('nome', 'area_id', 'role')
    ) THEN
        RAISE EXCEPTION 'FORBIDDEN_FIELDS';
    END IF;

    SELECT p.role, p.ativo INTO v_actor_role, v_actor_active
    FROM public.profissionais p WHERE p.id = p_actor_id;
    IF NOT FOUND OR v_actor_active IS NOT TRUE OR v_actor_role NOT IN ('admin', 'super_admin') THEN
        RAISE EXCEPTION 'FORBIDDEN: active administrator required';
    END IF;

    SELECT p.role, p.ativo INTO v_target_role, v_target_active
    FROM public.profissionais p WHERE p.id = p_professional_id;
    IF NOT FOUND OR v_target_active IS NOT TRUE THEN
        RAISE EXCEPTION 'ACTIVE_TARGET_NOT_FOUND';
    END IF;
    IF v_target_role = 'super_admin' THEN
        RAISE EXCEPTION 'SUPER_ADMIN_PROTECTED';
    END IF;

    IF v_actor_role = 'admin' THEN
        IF v_target_role <> 'staff' OR p_updates ? 'role' THEN
            RAISE EXCEPTION 'ROLE_SCOPE_FORBIDDEN';
        END IF;

        SELECT actor_link.empresa_id INTO v_shared_tenant
        FROM public.empresa_profissionais actor_link
        JOIN public.empresa_profissionais target_link
          ON target_link.empresa_id = actor_link.empresa_id
        JOIN public.empresas tenant ON tenant.id = actor_link.empresa_id
        WHERE actor_link.profissional_id = p_actor_id
          AND target_link.profissional_id = p_professional_id
          AND actor_link.ativo = true
          AND target_link.ativo = true
          AND tenant.ativo = true
          AND tenant.empresa_tipo = 'tenant'
        LIMIT 1;

        IF v_shared_tenant IS NULL THEN
            RAISE EXCEPTION 'TENANT_SCOPE_FORBIDDEN';
        END IF;
    END IF;

    IF p_updates ? 'nome' AND (
        jsonb_typeof(p_updates->'nome') <> 'string'
        OR length(trim(p_updates->>'nome')) < 2
        OR length(trim(p_updates->>'nome')) > 160
    ) THEN
        RAISE EXCEPTION 'INVALID_NAME';
    END IF;

    v_new_role := COALESCE(p_updates->>'role', v_target_role);
    IF v_new_role NOT IN ('admin', 'staff') THEN
        RAISE EXCEPTION 'INVALID_ROLE';
    END IF;

    IF p_updates ? 'role' AND v_actor_role <> 'super_admin' THEN
        RAISE EXCEPTION 'ROLE_SCOPE_FORBIDDEN';
    END IF;

    IF p_updates ? 'role' AND NOT EXISTS (
        SELECT 1
        FROM public.empresa_profissionais ep
        JOIN public.empresas e ON e.id = ep.empresa_id
        WHERE ep.profissional_id = p_professional_id
          AND ep.ativo = true
          AND e.ativo = true
          AND e.empresa_tipo = 'tenant'
    ) THEN
        RAISE EXCEPTION 'TENANT_LINK_REQUIRED';
    END IF;

    UPDATE public.profissionais
       SET nome = CASE WHEN p_updates ? 'nome' THEN trim(p_updates->>'nome') ELSE nome END,
           area_id = CASE WHEN p_updates ? 'area_id' THEN nullif(p_updates->>'area_id', '')::uuid ELSE area_id END,
           role = v_new_role
     WHERE id = p_professional_id;

    IF p_updates ? 'role' THEN
        UPDATE public.empresa_profissionais ep
           SET role = v_new_role,
               funcao = CASE WHEN v_new_role = 'admin' THEN 'Admin' ELSE 'Staff' END
          FROM public.empresas e
         WHERE ep.empresa_id = e.id
           AND ep.profissional_id = p_professional_id
           AND e.empresa_tipo = 'tenant'
           AND ep.ativo = true;
    END IF;

    RETURN (
        SELECT jsonb_build_object(
            'id', p.id,
            'nome', p.nome,
            'role', p.role,
            'ativo', p.ativo,
            'area_id', p.area_id
        )
        FROM public.profissionais p
        WHERE p.id = p_professional_id
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.create_tenant_db(
    p_company_name text,
    p_cnpj text,
    p_admin_id uuid,
    p_admin_name text,
    p_admin_email text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_company_id uuid;
BEGIN
    IF auth.role() <> 'service_role' THEN
        RAISE EXCEPTION 'FORBIDDEN: server-only operation';
    END IF;
    IF p_admin_id IS NULL OR nullif(trim(p_company_name), '') IS NULL
       OR nullif(trim(p_admin_name), '') IS NULL OR nullif(trim(p_admin_email), '') IS NULL THEN
        RAISE EXCEPTION 'INVALID_REQUEST';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM auth.users u
        WHERE u.id = p_admin_id
          AND u.deleted_at IS NULL
          AND lower(u.email) = lower(trim(p_admin_email))
    ) THEN
        RAISE EXCEPTION 'AUTH_PROFILE_MISMATCH';
    END IF;
    IF EXISTS (
        SELECT 1 FROM public.profissionais p
        WHERE p.id = p_admin_id
          AND (p.role <> 'staff' OR p.ativo = true)
    ) THEN
        RAISE EXCEPTION 'ADMIN_ACCOUNT_NOT_PENDING';
    END IF;

    INSERT INTO public.empresas (
        nome, cnpj, status_conta, icp_status, tipo_negocio,
        empresa_tipo, tenant_id, ativo
    ) VALUES (
        trim(p_company_name), nullif(trim(p_cnpj), ''), 'active', 'correct', 'other',
        'tenant', null, true
    ) RETURNING id INTO v_company_id;

    INSERT INTO public.profissionais (id, nome, email, role, ativo)
    VALUES (p_admin_id, trim(p_admin_name), lower(trim(p_admin_email)), 'staff', false)
    ON CONFLICT (id) DO UPDATE
       SET nome = EXCLUDED.nome,
           email = EXCLUDED.email;

    INSERT INTO public.empresa_profissionais (
        empresa_id, profissional_id, funcao, role, ativo
    ) VALUES (
        v_company_id, p_admin_id, 'Admin', 'staff', true
    )
    ON CONFLICT (empresa_id, profissional_id) DO UPDATE
       SET ativo = true,
           funcao = 'Admin';

    UPDATE public.profissionais
       SET role = 'admin', ativo = true
     WHERE id = p_admin_id;

    UPDATE public.empresa_profissionais
       SET role = 'admin', funcao = 'Admin', ativo = true
     WHERE empresa_id = v_company_id
       AND profissional_id = p_admin_id;

    RETURN v_company_id;
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
    v_actor_role text;
    v_actor_active boolean;
    v_target_role text;
    v_target_active boolean;
    v_shares_tenant boolean;
BEGIN
    IF auth.role() <> 'service_role' THEN
        RAISE EXCEPTION 'FORBIDDEN: server-only operation';
    END IF;
    IF p_actor_id IS NULL OR p_professional_id IS NULL THEN
        RAISE EXCEPTION 'INVALID_REQUEST';
    END IF;
    IF p_actor_id = p_professional_id THEN
        RAISE EXCEPTION 'SELF_DEACTIVATION_FORBIDDEN';
    END IF;

    SELECT p.role, p.ativo INTO v_actor_role, v_actor_active
    FROM public.profissionais p WHERE p.id = p_actor_id;
    IF NOT FOUND OR v_actor_active IS NOT TRUE OR v_actor_role NOT IN ('admin', 'super_admin') THEN
        RAISE EXCEPTION 'FORBIDDEN: active administrator required';
    END IF;

    SELECT p.role, p.ativo INTO v_target_role, v_target_active
    FROM public.profissionais p WHERE p.id = p_professional_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'PROFESSIONAL_NOT_FOUND'; END IF;
    IF v_target_role = 'super_admin' THEN RAISE EXCEPTION 'SUPER_ADMIN_PROTECTED'; END IF;

    IF v_actor_role = 'admin' THEN
        IF v_target_role <> 'staff' THEN RAISE EXCEPTION 'ROLE_SCOPE_FORBIDDEN'; END IF;

        SELECT EXISTS (
            SELECT 1
            FROM public.empresa_profissionais actor_link
            JOIN public.empresa_profissionais target_link
              ON target_link.empresa_id = actor_link.empresa_id
            JOIN public.empresas tenant ON tenant.id = actor_link.empresa_id
            WHERE actor_link.profissional_id = p_actor_id
              AND target_link.profissional_id = p_professional_id
              AND actor_link.ativo = true
              AND target_link.ativo = true
              AND tenant.ativo = true
              AND tenant.empresa_tipo = 'tenant'
        ) INTO v_shares_tenant;

        IF NOT v_shares_tenant THEN RAISE EXCEPTION 'TENANT_SCOPE_FORBIDDEN'; END IF;
    END IF;

    IF v_target_active IS TRUE THEN
        UPDATE public.profissionais SET ativo = false WHERE id = p_professional_id;
        UPDATE public.cliente_profissionais SET ativo = false
         WHERE profissional_id = p_professional_id AND ativo = true;
        UPDATE public.empresa_profissionais SET ativo = false
         WHERE profissional_id = p_professional_id AND ativo = true;
    END IF;

    RETURN jsonb_build_object(
        'status', CASE WHEN v_target_active IS TRUE THEN 'deactivated' ELSE 'already_deactivated' END,
        'professional_id', p_professional_id,
        'history_preserved', true
    );
END;
$$;

REVOKE ALL ON FUNCTION public.current_active_tenant_id() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_active_super_admin_identity() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_view_professional(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_view_company_membership(uuid, uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_manage_operational_membership(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_my_company_ids() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_visible_colleagues() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_current_identity() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.current_active_tenant_id() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_active_super_admin_identity() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_view_professional(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_view_company_membership(uuid, uuid, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_manage_operational_membership(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_my_company_ids() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_visible_colleagues() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_current_identity() TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.provision_professional_identity(uuid, uuid, text, text, uuid, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_professional_identity(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_tenant_db(text, text, uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.deactivate_professional(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.provision_professional_identity(uuid, uuid, text, text, uuid, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_professional_identity(uuid, uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_tenant_db(text, text, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.deactivate_professional(uuid, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.ensure_profissional_on_auth_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
    v_count integer;
BEGIN
    SELECT count(*) INTO v_count FROM public.profissionais WHERE role = 'profissional';
    IF v_count <> 0 THEN RAISE EXCEPTION 'POSTCONDITION_FAILED: legacy roles remain'; END IF;

    SELECT count(*) INTO v_count FROM public.profissionais WHERE role = 'super_admin';
    IF v_count <> 1 THEN RAISE EXCEPTION 'POSTCONDITION_FAILED: super_admin count is %', v_count; END IF;
    SELECT count(*) INTO v_count FROM public.profissionais WHERE role = 'admin';
    IF v_count <> 3 THEN RAISE EXCEPTION 'POSTCONDITION_FAILED: admin count is %', v_count; END IF;
    SELECT count(*) INTO v_count FROM public.profissionais WHERE role = 'staff';
    IF v_count <> 17 THEN RAISE EXCEPTION 'POSTCONDITION_FAILED: staff count is %', v_count; END IF;

    SELECT count(*) INTO v_count
    FROM public.empresa_profissionais ep
    JOIN public.empresas e ON e.id = ep.empresa_id
    WHERE ep.ativo = true AND e.ativo = false;
    IF v_count <> 0 THEN RAISE EXCEPTION 'POSTCONDITION_FAILED: % stale active links remain', v_count; END IF;

    SELECT count(*) INTO v_count
    FROM public.empresa_profissionais ep
    JOIN public.empresas e ON e.id = ep.empresa_id
    JOIN public.profissionais p ON p.id = ep.profissional_id
    WHERE ep.ativo = true
      AND e.ativo = true
      AND e.empresa_tipo = 'tenant'
      AND ep.role IS DISTINCT FROM p.role;
    IF v_count <> 0 THEN RAISE EXCEPTION 'POSTCONDITION_FAILED: % tenant role mismatches remain', v_count; END IF;

    SELECT count(*) INTO v_count
    FROM public.profissionais p
    WHERE p.ativo = true
      AND p.role IN ('admin', 'staff')
      AND 1 <> (
          SELECT count(*)
          FROM public.empresa_profissionais ep
          JOIN public.empresas e ON e.id = ep.empresa_id
          WHERE ep.profissional_id = p.id
            AND ep.ativo = true
            AND e.ativo = true
            AND e.empresa_tipo = 'tenant'
      );
    IF v_count <> 0 THEN RAISE EXCEPTION 'POSTCONDITION_FAILED: % active users lack tenant context', v_count; END IF;

    SELECT count(*) INTO v_count
    FROM public.empresa_profissionais ep
    JOIN public.profissionais p ON p.id = ep.profissional_id
    WHERE p.role = 'super_admin' AND ep.ativo = true;
    IF v_count <> 0 THEN RAISE EXCEPTION 'POSTCONDITION_FAILED: super administrator has active links'; END IF;
END;
$$;

COMMIT;
