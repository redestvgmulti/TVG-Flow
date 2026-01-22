-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- MIGRATION: CANONICAL RBAC CORRECTION
-- Created: 2026-01-22
-- Purpose: Enforce single source of truth for user roles (profissionais.role)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- PART 1: CORRIGIR is_super_admin()
-- Objetivo: Remover qualquer lógica de email/metadata. Fonte única: profissionais.role
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE OR REPLACE FUNCTION is_super_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM profissionais
    WHERE id = auth.uid()
      AND role = 'super_admin'
      AND ativo = true
  );
$$;

COMMENT ON FUNCTION is_super_admin IS 'Canonical check for Super Admin role. Source: public.profissionais.role only.';

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- PART 2: CORRIGIR is_admin_in_empresa()
-- Objetivo: Garantir isolamento. Super Admin NÃO é admin de empresa automaticamente.
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE OR REPLACE FUNCTION is_admin_in_empresa(empresa_uuid UUID)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1
        FROM empresa_profissionais ep
        INNER JOIN profissionais p ON ep.profissional_id = p.id
        WHERE ep.empresa_id = empresa_uuid
            AND p.id = auth.uid()
            -- REGRA DE OURO: Apenas 'admin' explícito tem poder de gestão no tenant
            -- Super Admins devem ter papel 'admin' explícito se precisarem operar empresas
            AND p.role = 'admin' 
            AND ep.ativo = TRUE
    );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

COMMENT ON FUNCTION is_admin_in_empresa IS 'Checks if user is an explicit admin for the specific company. Super Admins are excluded explicitly.';

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- PART 3: TRIGGER ANTI-ZUMBI
-- Objetivo: Garantir que todo usuário auth.users tenha registro em profissionais
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE OR REPLACE FUNCTION ensure_profissional_on_auth_user()
RETURNS TRIGGER AS $$
BEGIN
  -- Cria perfil profissional básico se não existir
  -- Default role: 'staff' (seguro por padrão)
  INSERT INTO profissionais (id, email, role, ativo)
  VALUES (NEW.id, NEW.email, 'staff', true)
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Remove safe if exists to ensure clean state or idempotent application
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION ensure_profissional_on_auth_user();

COMMENT ON FUNCTION ensure_profissional_on_auth_user IS 'Automatically creates a professional profile for new Auth users to prevent "zombie" users without roles.';
