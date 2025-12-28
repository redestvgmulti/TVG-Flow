-- Migration: Fix Admin RLS to allow Tenant Visibility
-- Description: Updates RLS policy so Admins can see their own Tenant company data.

DROP POLICY IF EXISTS "admin_empresas_select" ON empresas;

CREATE POLICY "admin_empresas_select" ON empresas
FOR SELECT TO authenticated
USING (
  -- 1. View Operational companies managed by my tenant
  (
    empresa_tipo = 'operacional' 
    AND tenant_id IN (
      SELECT ep.empresa_id 
      FROM empresa_profissionais ep
      WHERE ep.profissional_id = auth.uid()
    )
  )
  OR
  -- 2. View MY OWN linked companies (allows seeing the Tenant I belong to)
  (
    id IN (
      SELECT ep.empresa_id 
      FROM empresa_profissionais ep
      WHERE ep.profissional_id = auth.uid()
    )
  )
);
