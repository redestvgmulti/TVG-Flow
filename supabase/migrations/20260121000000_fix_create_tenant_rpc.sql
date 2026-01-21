-- Migration: Fix Create Tenant RPC Order of Operations
-- Description: Updates safe_create_tenant_db to prevent TENANT_LINK_REQUIRED error by ensuring tenant link exists before admin promotion.
-- Fixes NULL role constraint by initializing as 'staff'.

CREATE OR REPLACE FUNCTION create_tenant_db(
    p_company_name TEXT,
    p_cnpj TEXT,
    p_admin_id UUID,
    p_admin_name TEXT,
    p_admin_email TEXT
) RETURNS UUID AS $$
DECLARE
    new_company_id UUID;
BEGIN
    -- 1. Create Company
    INSERT INTO empresas (nome, cnpj, status_conta, icp_status, tipo_negocio)
    VALUES (p_company_name, p_cnpj, 'active', 'correct', 'other')
    RETURNING id INTO new_company_id;

    -- 2. Ensure Professional Profile Exists
    -- CRITICAL FIX: Do NOT set 'admin' role yet. Insert with safe default 'staff'.
    -- The role column is NOT NULL, so we must provide a value. 'staff' is safe.
    INSERT INTO profissionais (id, nome, email, ativo, role)
    VALUES (p_admin_id, p_admin_name, p_admin_email, true, 'staff')
    ON CONFLICT (id) DO UPDATE
    SET nome = p_admin_name, ativo = true;
    -- Note: We intentionally do NOT update role on conflict to avoid demoting existing admins if any 
    -- (though this flow is for new tenants, handling conflict is good practice).

    -- 3. Link Admin to Company
    INSERT INTO empresa_profissionais (empresa_id, profissional_id)
    VALUES (new_company_id, p_admin_id)
    ON CONFLICT (empresa_id, profissional_id) DO NOTHING;

    -- 4. Promote to Admin (Now safe because tenant link exists)
    UPDATE profissionais
    SET role = 'admin'
    WHERE id = p_admin_id;

    RETURN new_company_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
