-- Migration: Add drive_link column to clientes table with explicit RLS
-- Description: Adds drive_link column and ensures RLS policies support Content tab requirements
-- Author: TVG Flow Team
-- Date: 2025-12-26
-- Version: 1.3 (Fixed - uses profissionais table directly)

-- ============================================================================
-- SCHEMA CHANGES
-- ============================================================================

-- Add drive_link column
ALTER TABLE clientes 
ADD COLUMN IF NOT EXISTS drive_link TEXT;

-- Add comment for documentation
COMMENT ON COLUMN clientes.drive_link IS 'Google Drive folder URL for company files. Optional field used in Content tab. Inherited by tasks without specific drive_link.';

-- ============================================================================
-- RLS POLICIES (EXPLICIT CONTRACT)
-- ============================================================================

-- Note: Using profissionais table directly with role='admin' check
-- This matches the pattern from existing migrations (20251224150000_fix_rls_table_references.sql)

-- Drop existing policies if they exist (idempotent)
DROP POLICY IF EXISTS "Admin tem acesso total a clientes" ON clientes;
DROP POLICY IF EXISTS "Profissional pode visualizar clientes" ON clientes;
DROP POLICY IF EXISTS "Admin can manage all companies" ON clientes;
DROP POLICY IF EXISTS "Professionals can view their companies" ON clientes;
DROP POLICY IF EXISTS "Staff can view active companies with drive" ON clientes;

-- Policy 1: Admin full access (all operations, all companies)
CREATE POLICY "Admin can manage all companies"
    ON clientes
    FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM profissionais
            WHERE profissionais.id = auth.uid()
            AND profissionais.role = 'admin'
        )
    );

-- Policy 2: Staff can view companies (base visibility)
-- This allows staff to see companies in general contexts
CREATE POLICY "Professionals can view companies"
    ON clientes
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM profissionais
            WHERE profissionais.id = auth.uid()
            AND profissionais.ativo = true
        )
    );

-- ============================================================================
-- PRODUCT CONTRACT: DRIVE INHERITANCE
-- ============================================================================

-- IMPORTANT: This is a PRODUCT-LEVEL CONTRACT, not a database constraint.
-- 
-- Rule: When a task (tarefas or tarefas_itens) does NOT have its own drive_link,
--       the application MUST use the drive_link from the associated company (clientes).
--
-- Implementation: Frontend logic in task detail views and Content tab.
-- Priority: task.drive_link > company.drive_link > null
--
-- Example:
--   const driveLink = task.drive_link || task.empresa?.drive_link || null;
--
-- This ensures consistent Drive access across the application without duplicating links.

-- ============================================================================
-- CONTENT TAB FILTERING (FRONTEND RESPONSIBILITY)
-- ============================================================================

-- Note: The Content tab implements additional filtering in the frontend:
-- 
-- Admin sees: All companies (with/without drive_link)
-- Staff sees: Only companies where ativo=true AND drive_link IS NOT NULL
--
-- This filtering is done via Supabase query filters in the frontend code:
--   .eq('ativo', true)
--   .not('drive_link', 'is', null)
--
-- RLS ensures Staff can only access companies they're authorized to see.
-- The frontend query adds the business logic filters for the Content tab.

-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================

-- Verify column was added
-- SELECT column_name, data_type, is_nullable 
-- FROM information_schema.columns 
-- WHERE table_name = 'clientes' AND column_name = 'drive_link';

-- Verify RLS policies
-- SELECT policyname, permissive, roles, cmd, qual 
-- FROM pg_policies 
-- WHERE tablename = 'clientes';
