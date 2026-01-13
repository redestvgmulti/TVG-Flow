-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- FlowOS - Permission-Based Professional Access
-- Create empresa_profissionais_permitidos table
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 
-- Purpose: Track which professionals (from a tenant) can work on which 
--          operational companies. This is PERMISSION, not OWNERSHIP.
--
-- Key Principles:
--   - Professionals belong to the TENANT (ownership)
--   - This table defines AUTHORIZATION to work on operational companies
--   - Removing permission does NOT remove the professional from tenant
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Create the permissions table
CREATE TABLE IF NOT EXISTS empresa_profissionais_permitidos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  empresa_operacional_id UUID NOT NULL,
  profissional_id UUID NOT NULL,
  ativo BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Foreign Keys
  CONSTRAINT fk_empresa_operacional
    FOREIGN KEY (empresa_operacional_id)
    REFERENCES empresas(id)
    ON DELETE CASCADE,

  CONSTRAINT fk_profissional
    FOREIGN KEY (profissional_id)
    REFERENCES profissionais(id)
    ON DELETE CASCADE,

  -- Ensure tenant consistency
  CONSTRAINT fk_tenant
    FOREIGN KEY (tenant_id)
    REFERENCES empresas(id)
    ON DELETE CASCADE,

  -- Prevent duplicate permissions
  CONSTRAINT unique_profissional_empresa
    UNIQUE (empresa_operacional_id, profissional_id)
);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- INDICES FOR PERFORMANCE
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE INDEX IF NOT EXISTS idx_epp_tenant 
  ON empresa_profissionais_permitidos(tenant_id);

CREATE INDEX IF NOT EXISTS idx_epp_empresa 
  ON empresa_profissionais_permitidos(empresa_operacional_id);

CREATE INDEX IF NOT EXISTS idx_epp_profissional 
  ON empresa_profissionais_permitidos(profissional_id);

CREATE INDEX IF NOT EXISTS idx_epp_ativo 
  ON empresa_profissionais_permitidos(ativo);

-- Composite index for the most common query pattern
CREATE INDEX IF NOT EXISTS idx_epp_empresa_ativo 
  ON empresa_profissionais_permitidos(empresa_operacional_id, ativo);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- SECURITY: ROW LEVEL SECURITY POLICIES
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Enable RLS
ALTER TABLE empresa_profissionais_permitidos ENABLE ROW LEVEL SECURITY;

-- SELECT: Users can only see permissions for their tenant
CREATE POLICY "Users can view permissions within their tenant"
  ON empresa_profissionais_permitidos
  FOR SELECT
  USING (
    tenant_id IN (
      SELECT DISTINCT COALESCE(e.tenant_id, e.id)
      FROM empresas e
      JOIN empresa_profissionais ep ON ep.empresa_id = e.id
      WHERE ep.profissional_id = auth.uid()
        AND ep.ativo = true
        AND e.ativo = true
    )
  );

-- INSERT: Only admins can create permissions
CREATE POLICY "Admins can create permissions for their tenant"
  ON empresa_profissionais_permitidos
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM profissionais p
      JOIN empresa_profissionais ep ON ep.profissional_id = p.id
      JOIN empresas e ON e.id = ep.empresa_id
      WHERE p.id = auth.uid()
        AND p.role = 'admin'
        AND p.ativo = true
        AND COALESCE(e.tenant_id, e.id) = tenant_id
    )
  );

-- UPDATE: Only admins can update permissions
CREATE POLICY "Admins can update permissions for their tenant"
  ON empresa_profissionais_permitidos
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM profissionais p
      JOIN empresa_profissionais ep ON ep.profissional_id = p.id
      JOIN empresas e ON e.id = ep.empresa_id
      WHERE p.id = auth.uid()
        AND p.role = 'admin'
        AND p.ativo = true
        AND COALESCE(e.tenant_id, e.id) = tenant_id
    )
  );

-- DELETE: Only admins can delete permissions
CREATE POLICY "Admins can delete permissions for their tenant"
  ON empresa_profissionais_permitidos
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1
      FROM profissionais p
      JOIN empresa_profissionais ep ON ep.profissional_id = p.id
      JOIN empresas e ON e.id = ep.empresa_id
      WHERE p.id = auth.uid()
        AND p.role = 'admin'
        AND p.ativo = true
        AND COALESCE(e.tenant_id, e.id) = tenant_id
    )
  );

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- TRIGGER: Auto-update updated_at
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE OR REPLACE FUNCTION update_empresa_profissionais_permitidos_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_epp_updated_at
  BEFORE UPDATE ON empresa_profissionais_permitidos
  FOR EACH ROW
  EXECUTE FUNCTION update_empresa_profissionais_permitidos_updated_at();

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- COMMENTS
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

COMMENT ON TABLE empresa_profissionais_permitidos IS 
  'Permission table: Which professionals can work on which operational companies. This is authorization, not ownership.';

COMMENT ON COLUMN empresa_profissionais_permitidos.tenant_id IS 
  'Tenant that owns both the professional and the operational company';

COMMENT ON COLUMN empresa_profissionais_permitidos.empresa_operacional_id IS 
  'Operational company the professional is allowed to work on';

COMMENT ON COLUMN empresa_profissionais_permitidos.profissional_id IS 
  'Professional who has permission to work on this company';

COMMENT ON COLUMN empresa_profissionais_permitidos.ativo IS 
  'Whether the permission is currently active';
