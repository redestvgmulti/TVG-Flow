-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- FlowOS - Function Permission Layer
-- Create empresa_funcoes_permitidas table
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 
-- Purpose: Track which functions are available for which operational companies.
--          This enables workflow mode to list available functions correctly.
--
-- Key Principles:
--   - Functions define WHAT work can be done on a company
--   - Professionals are mapped to functions via empresa_profissionais
--   - This table is the source of truth for workflow function selection
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Create the function permissions table
CREATE TABLE IF NOT EXISTS empresa_funcoes_permitidas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  empresa_operacional_id UUID NOT NULL,
  funcao TEXT NOT NULL,
  ativo BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Foreign Keys
  CONSTRAINT fk_empresa_operacional
    FOREIGN KEY (empresa_operacional_id)
    REFERENCES empresas(id)
    ON DELETE CASCADE,

  CONSTRAINT fk_tenant
    FOREIGN KEY (tenant_id)
    REFERENCES empresas(id)
    ON DELETE CASCADE,

  -- Prevent duplicate function permissions per company
  CONSTRAINT unique_empresa_funcao
    UNIQUE (empresa_operacional_id, funcao)
);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- INDICES FOR PERFORMANCE
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE INDEX IF NOT EXISTS idx_efp_tenant 
  ON empresa_funcoes_permitidas(tenant_id);

CREATE INDEX IF NOT EXISTS idx_efp_empresa 
  ON empresa_funcoes_permitidas(empresa_operacional_id);

CREATE INDEX IF NOT EXISTS idx_efp_funcao 
  ON empresa_funcoes_permitidas(funcao);

CREATE INDEX IF NOT EXISTS idx_efp_ativo 
  ON empresa_funcoes_permitidas(ativo);

-- Composite index for the most common query pattern
CREATE INDEX IF NOT EXISTS idx_efp_empresa_ativo 
  ON empresa_funcoes_permitidas(empresa_operacional_id, ativo);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- SECURITY: ROW LEVEL SECURITY POLICIES
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Enable RLS
ALTER TABLE empresa_funcoes_permitidas ENABLE ROW LEVEL SECURITY;

-- SELECT: Users can only see functions for their tenant
CREATE POLICY "Users can view functions within their tenant"
  ON empresa_funcoes_permitidas
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

-- INSERT: Only admins can create function permissions
CREATE POLICY "Admins can create function permissions for their tenant"
  ON empresa_funcoes_permitidas
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

-- UPDATE: Only admins can update function permissions
CREATE POLICY "Admins can update function permissions for their tenant"
  ON empresa_funcoes_permitidas
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

-- DELETE: Only admins can delete function permissions
CREATE POLICY "Admins can delete function permissions for their tenant"
  ON empresa_funcoes_permitidas
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

CREATE OR REPLACE FUNCTION update_empresa_funcoes_permitidas_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_efp_updated_at
  BEFORE UPDATE ON empresa_funcoes_permitidas
  FOR EACH ROW
  EXECUTE FUNCTION update_empresa_funcoes_permitidas_updated_at();

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- COMMENTS
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

COMMENT ON TABLE empresa_funcoes_permitidas IS 
  'Function permission table: Which functions are available for which operational companies. Source of truth for workflow mode.';

COMMENT ON COLUMN empresa_funcoes_permitidas.tenant_id IS 
  'Tenant that owns the operational company';

COMMENT ON COLUMN empresa_funcoes_permitidas.empresa_operacional_id IS 
  'Operational company where this function is available';

COMMENT ON COLUMN empresa_funcoes_permitidas.funcao IS 
  'Function name (e.g., "Designer", "Redator", "Social Media")';

COMMENT ON COLUMN empresa_funcoes_permitidas.ativo IS 
  'Whether this function permission is currently active';
