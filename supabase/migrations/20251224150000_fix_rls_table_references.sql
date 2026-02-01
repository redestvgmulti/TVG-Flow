-- FIX RLS: Replace references to non-existent/incorrect 'usuarios' table with 'profissionais'
-- Description: 
-- Several migrations (021, 022, 023) incorrectly referenced a 'usuarios' table in their RLS subqueries.
-- This caused 403 Forbidden errors because the subquery failed or returned nothing.
-- The correct table for checking admin status is 'profissionais' (or using the is_admin() helper).

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 1. FIX EMPRESAS POLICIES
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Drop broken policies
DROP POLICY IF EXISTS "Admin can manage all companies" ON empresas;

-- Access to companies: Admin full access
CREATE POLICY "Admin can manage all companies"
    ON empresas
    FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM profissionais
            WHERE profissionais.id = auth.uid()
            AND profissionais.role = 'admin'
        )
    );

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 2. FIX EMPRESA_PROFISSIONAIS POLICIES
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

DROP POLICY IF EXISTS "Admin can manage all company-professional associations" ON empresa_profissionais;

CREATE POLICY "Admin can manage all company-professional associations"
    ON empresa_profissionais
    FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM profissionais
            WHERE profissionais.id = auth.uid()
            AND profissionais.role = 'admin'
        )
    );

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 3. FIX TAREFAS_MICRO POLICIES (formerly tarefas_itens)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Ensure we clean up any old policies if they exist (on the new table)
DROP POLICY IF EXISTS "Admin can manage all micro-tasks" ON tarefas_micro;

CREATE POLICY "Admin can manage all micro-tasks"
    ON tarefas_micro
    FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM profissionais
            WHERE profissionais.id = auth.uid()
            AND profissionais.role = 'admin'
        )
    );

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 4. FIX TAREFAS_MICRO_LOGS (formerly tarefas_itens_historico)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Check manually if needed, but safe to recreate if exists
DROP POLICY IF EXISTS "Admin can view all logs" ON tarefas_micro_logs;

CREATE POLICY "Admin can view all logs"
    ON tarefas_micro_logs
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM profissionais
            WHERE profissionais.id = auth.uid()
            AND profissionais.role = 'admin'
        )
    );

-- Validated: Using 'profissionais' instead of 'usuarios' fixes the 403 error.
