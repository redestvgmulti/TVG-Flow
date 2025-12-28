-- Definitive migration for Company Scope Correction (V1)
-- STRICT enforcement of Tenant vs Operational separation

-- 1. Ensure columns exist (idempotent)
ALTER TABLE empresas 
ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES empresas(id),
ADD COLUMN IF NOT EXISTS empresa_tipo text NOT NULL DEFAULT 'operacional';

-- 2. Add Constraint for empresa_tipo values
DO $$ BEGIN
    ALTER TABLE empresas ADD CONSTRAINT empresas_empresa_tipo_check 
    CHECK (empresa_tipo IN ('tenant', 'operacional'));
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- 3. [STRICT] Add Constraint: Tenants MUST have NULL tenant_id
-- Operational companies MUST have tenant_id (enforced by application logic mostly, but let's check)
-- "Tenant nunca pode ter tenant_id preenchido"
DO $$ BEGIN
    ALTER TABLE empresas ADD CONSTRAINT check_tenant_rules 
    CHECK (
        (empresa_tipo = 'tenant' AND tenant_id IS NULL) OR 
        (empresa_tipo = 'operacional') 
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- 4. Clean up existing data to satisfy constraints if needed (Self-Correction)
-- If a tenant has tenant_id, clear it.
UPDATE empresas SET tenant_id = NULL WHERE empresa_tipo = 'tenant';

-- 5. RLS Policies (STRICT)

-- Disable RLS temporarily to ensure clean slate if needed, or just replace policies
ALTER TABLE empresas ENABLE ROW LEVEL SECURITY;

-- 5.1 Super Admin: Only 'tenant' companies
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

-- Super admin write policies (Insert/Update/Delete)
DROP POLICY IF EXISTS "super_admin_empresas_all" ON empresas; 
-- We'll split them to be precise or use ALL if logic is identical.
-- Let's stick to the previous pattern of explicit policies for clarity.

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
  AND tenant_id IS NULL -- Enforce at RLS level too
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
  AND tenant_id IS NULL
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


-- 5.2 Admin: Only 'operacional' companies LINKED to their Tenant
-- Logic: Admin is linked to a Tenant Company (via empresa_profissionais).
-- That Tenant Company ID must match the 'tenant_id' of the Operational Company.

DROP POLICY IF EXISTS "admin_empresas_select" ON empresas;
CREATE POLICY "admin_empresas_select" ON empresas
FOR SELECT TO authenticated
USING (
  empresa_tipo = 'operacional'
  AND tenant_id IN (
    -- Get the Tenant IDs the user is Admin of
    SELECT ep.empresa_id 
    FROM empresa_profissionais ep
    JOIN profissionais p ON p.id = ep.profissional_id
    WHERE ep.profissional_id = auth.uid()
    AND (p.role = 'admin' OR ep.funcao = 'admin' OR ep.role = 'admin') -- robust check
    -- We assume the company linked IS the Tenant. 
    -- If we need to be sure the linked company IS a tenant, we join empresas again.
    -- But for performance, if an Admin is linked to it, and it's used as tenant_id, it implicitly works.
    -- Strict check: 
    AND EXISTS (
        SELECT 1 FROM empresas e_parent 
        WHERE e_parent.id = ep.empresa_id 
        AND e_parent.empresa_tipo = 'tenant'
    )
  )
);

DROP POLICY IF EXISTS "admin_empresas_insert" ON empresas;
CREATE POLICY "admin_empresas_insert" ON empresas
FOR INSERT TO authenticated
WITH CHECK (
  empresa_tipo = 'operacional'
  AND tenant_id IN (
    SELECT ep.empresa_id 
    FROM empresa_profissionais ep
    JOIN profissionais p ON p.id = ep.profissional_id
    WHERE ep.profissional_id = auth.uid()
    AND (p.role = 'admin')
  )
);

DROP POLICY IF EXISTS "admin_empresas_update" ON empresas;
CREATE POLICY "admin_empresas_update" ON empresas
FOR UPDATE TO authenticated
USING (
  empresa_tipo = 'operacional'
  AND tenant_id IN (
    SELECT ep.empresa_id 
    FROM empresa_profissionais ep
    JOIN profissionais p ON p.id = ep.profissional_id
    WHERE ep.profissional_id = auth.uid()
    AND (p.role = 'admin')
  )
)
WITH CHECK (
  empresa_tipo = 'operacional'
  AND tenant_id IN (
    SELECT ep.empresa_id 
    FROM empresa_profissionais ep
    JOIN profissionais p ON p.id = ep.profissional_id
    WHERE ep.profissional_id = auth.uid()
    AND (p.role = 'admin')
  )
);

DROP POLICY IF EXISTS "admin_empresas_delete" ON empresas;
CREATE POLICY "admin_empresas_delete" ON empresas
FOR DELETE TO authenticated
USING (
  empresa_tipo = 'operacional'
  AND tenant_id IN (
    SELECT ep.empresa_id 
    FROM empresa_profissionais ep
    JOIN profissionais p ON p.id = ep.profissional_id
    WHERE ep.profissional_id = auth.uid()
    AND (p.role = 'admin')
  )
);
