-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- MIGRATION: RLS HARDENING PHASE 1 (RESTRICTIVE POLICIES)
-- DATE: 2026-01-23
-- DESCRIPTION: Applies "AS RESTRICTIVE" policies to enforce tenant isolation
-- on critical tables without modifying legacy permissive policies.
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 1. HARDEN TABLE: TAREFAS
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Ensure the restrictive policy exists. 
-- Logic: 
-- IF user is Super Admin -> PASS
-- IF user is Admin -> MUST MATCH TENANT (empresa_id)
-- IF user is NOT Admin (e.g. Staff) -> PASS (Allow existing permissive policies to handle logic)

DO $$
BEGIN
    -- Drop likely drafts to ensure clean apply
    DROP POLICY IF EXISTS "Global Constraint: Tenant Isolation for Admins" ON tarefas;
END $$;

CREATE POLICY "Global Constraint: Tenant Isolation for Admins"
ON tarefas
AS RESTRICTIVE
FOR ALL
TO authenticated
USING (
    is_super_admin()
    OR 
    (
        -- If Admin, enforce strict tenant check
        CASE 
            WHEN is_admin() THEN 
                (
                    -- Must have valid link to the task's company
                    EXISTS (
                        SELECT 1 
                        FROM empresa_profissionais ep
                        WHERE ep.profissional_id = auth.uid()
                        AND ep.empresa_id = tarefas.empresa_id
                        AND ep.ativo = true
                    )
                    -- OR be the creator (Admins creating tasks)
                    OR 
                    (created_by = auth.uid()) 
                )
            ELSE 
                -- Non-admins (Staff) are passed through to standard policies
                TRUE
        END
    )
);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 2. HARDEN TABLE: TAREFAS_MICRO
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

DO $$
BEGIN
    DROP POLICY IF EXISTS "Global Constraint: Tenant Isolation for Admins" ON tarefas_micro;
END $$;

CREATE POLICY "Global Constraint: Tenant Isolation for Admins"
ON tarefas_micro
AS RESTRICTIVE
FOR ALL
TO authenticated
USING (
    is_super_admin()
    OR 
    (
        CASE 
            WHEN is_admin() THEN 
                (
                    EXISTS (
                        SELECT 1 
                        FROM tarefas t
                        JOIN empresa_profissionais ep ON t.empresa_id = ep.empresa_id
                        WHERE t.id = tarefas_micro.tarefa_id
                        AND ep.profissional_id = auth.uid()
                        AND ep.ativo = true
                    )
                )
            ELSE 
                TRUE
        END
    )
);

-- Note: We use CASE WHEN is_admin() to avoid relying on NOT is_admin() which might be ambiguous
-- if roles change. This explicitly targets the 'admin' role for restriction.
