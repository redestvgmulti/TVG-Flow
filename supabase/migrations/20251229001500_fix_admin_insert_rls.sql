-- Migration: Fix Admin RLS for Insert/Update/Delete
-- Description: Updates Write policies so Admins can manage companies linked to their Tenant.

-- INSERT
DROP POLICY IF EXISTS "admin_empresas_insert" ON empresas;
CREATE POLICY "admin_empresas_insert" ON empresas
FOR INSERT TO authenticated
WITH CHECK (
  empresa_tipo = 'operacional'
  AND tenant_id IN (
    SELECT ep.empresa_id 
    FROM empresa_profissionais ep
    WHERE ep.profissional_id = auth.uid()
    -- We trust that if they are linked to the Tenant, they can create ops companies for it.
    -- This matches the context logic used in the frontend.
  )
);

-- UPDATE
DROP POLICY IF EXISTS "admin_empresas_update" ON empresas;
CREATE POLICY "admin_empresas_update" ON empresas
FOR UPDATE TO authenticated
USING (
  empresa_tipo = 'operacional'
  AND tenant_id IN (
    SELECT ep.empresa_id 
    FROM empresa_profissionais ep
    WHERE ep.profissional_id = auth.uid()
  )
)
WITH CHECK (
  empresa_tipo = 'operacional'
  AND tenant_id IN (
    SELECT ep.empresa_id 
    FROM empresa_profissionais ep
    WHERE ep.profissional_id = auth.uid()
  )
);

-- DELETE
DROP POLICY IF EXISTS "admin_empresas_delete" ON empresas;
CREATE POLICY "admin_empresas_delete" ON empresas
FOR DELETE TO authenticated
USING (
  empresa_tipo = 'operacional'
  AND tenant_id IN (
    SELECT ep.empresa_id 
    FROM empresa_profissionais ep
    WHERE ep.profissional_id = auth.uid()
  )
);
