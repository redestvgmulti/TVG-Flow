-- Add tenant_id and empresa_tipo fields to distinguish tenant vs operational companies
ALTER TABLE empresas 
ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES empresas(id),
ADD COLUMN IF NOT EXISTS empresa_tipo text NOT NULL DEFAULT 'operacional' 
CHECK (empresa_tipo IN ('tenant', 'operacional'));

-- Update existing companies based on context
-- Companies without tenant_id or where tenant_id = id are tenants
UPDATE empresas 
SET empresa_tipo = 'tenant' 
WHERE tenant_id IS NULL OR tenant_id = id;

-- Drop and recreate RLS policies for empresas table

-- Super Admin: full access to tenant companies only
DROP POLICY IF EXISTS "super_admin_empresas_select" ON empresas;
CREATE POLICY "super_admin_empresas_select" ON empresas
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profissionais 
    WHERE profissionais.id = auth.uid() 
    AND profissionais.role = 'super_admin'
  )
  AND empresa_tipo = 'tenant'
);

DROP POLICY IF EXISTS "super_admin_empresas_insert" ON empresas;
CREATE POLICY "super_admin_empresas_insert" ON empresas
FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM profissionais 
    WHERE profissionais.id = auth.uid() 
    AND profissionais.role = 'super_admin'
  )
  AND empresa_tipo = 'tenant'
);

DROP POLICY IF EXISTS "super_admin_empresas_update" ON empresas;
CREATE POLICY "super_admin_empresas_update" ON empresas
FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profissionais 
    WHERE profissionais.id = auth.uid() 
    AND profissionais.role = 'super_admin'
  )
  AND empresa_tipo = 'tenant'
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM profissionais 
    WHERE profissionais.id = auth.uid() 
    AND profissionais.role = 'super_admin'
  )
  AND empresa_tipo = 'tenant'
);

DROP POLICY IF EXISTS "super_admin_empresas_delete" ON empresas;
CREATE POLICY "super_admin_empresas_delete" ON empresas
FOR DELETE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profissionais 
    WHERE profissionais.id = auth.uid() 
    AND profissionais.role = 'super_admin'
  )
  AND empresa_tipo = 'tenant'
);

-- Admin: access to operational companies within their tenant only
DROP POLICY IF EXISTS "admin_empresas_select" ON empresas;
CREATE POLICY "admin_empresas_select" ON empresas
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profissionais 
    WHERE profissionais.id = auth.uid() 
    AND profissionais.role = 'admin'
    AND EXISTS (
      SELECT 1 FROM empresa_profissionais ep
      WHERE ep.profissional_id = profissionais.id
      AND ep.empresa_id = empresas.tenant_id
    )
  )
  AND empresa_tipo = 'operacional'
);

DROP POLICY IF EXISTS "admin_empresas_insert" ON empresas;
CREATE POLICY "admin_empresas_insert" ON empresas
FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM profissionais 
    WHERE profissionais.id = auth.uid() 
    AND profissionais.role = 'admin'
    AND EXISTS (
      SELECT 1 FROM empresa_profissionais ep
      WHERE ep.profissional_id = profissionais.id
      AND ep.empresa_id = empresas.tenant_id
    )
  )
  AND empresa_tipo = 'operacional'
);

DROP POLICY IF EXISTS "admin_empresas_update" ON empresas;
CREATE POLICY "admin_empresas_update" ON empresas
FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profissionais 
    WHERE profissionais.id = auth.uid() 
    AND profissionais.role = 'admin'
    AND EXISTS (
      SELECT 1 FROM empresa_profissionais ep
      WHERE ep.profissional_id = profissionais.id
      AND ep.empresa_id = empresas.tenant_id
    )
  )
  AND empresa_tipo = 'operacional'
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM profissionais 
    WHERE profissionais.id = auth.uid() 
    AND profissionais.role = 'admin'
    AND EXISTS (
      SELECT 1 FROM empresa_profissionais ep
      WHERE ep.profissional_id = profissionais.id
      AND ep.empresa_id = empresas.tenant_id
    )
  )
  AND empresa_tipo = 'operacional'
);

DROP POLICY IF EXISTS "admin_empresas_delete" ON empresas;
CREATE POLICY "admin_empresas_delete" ON empresas
FOR DELETE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profissionais 
    WHERE profissionais.id = auth.uid() 
    AND profissionais.role = 'admin'
    AND EXISTS (
      SELECT 1 FROM empresa_profissionais ep
      WHERE ep.profissional_id = profissionais.id
      AND ep.empresa_id = empresas.tenant_id
    )
  )
  AND empresa_tipo = 'operacional'
);
