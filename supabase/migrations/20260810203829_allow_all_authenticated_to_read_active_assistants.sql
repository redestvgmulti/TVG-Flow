-- Active assistants are a shared product catalog for every signed-in user.
-- Management remains governed by assistentes_manage_scoped.
DROP POLICY IF EXISTS assistentes_select_scoped ON public.assistentes;

CREATE POLICY assistentes_select_scoped ON public.assistentes
FOR SELECT TO authenticated
USING (
    assistentes.ativo = true
    OR public.is_super_admin()
    OR (
        assistentes.tenant_id IS NULL
        AND assistentes.created_by = auth.uid()
    )
    OR (
        public.is_admin_safe()
        AND assistentes.tenant_id IS NOT NULL
        AND public.is_admin_of_tenant(assistentes.tenant_id)
    )
);
