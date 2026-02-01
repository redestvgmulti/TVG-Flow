-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- MIGRATION: RLS HARDENING PHASE 1 (RESTRICTIVE POLICIES) - RETRY
-- DATE: 2026-01-23
-- DESCRIPTION: Applies "AS RESTRICTIVE" policies to enforce tenant isolation.
-- Uses schema-qualified function calls to avoid search_path ambiguity.
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 1. HARDEN TABLE: TAREFAS
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

DO $$
BEGIN
    DROP POLICY IF EXISTS "Global Constraint: Tenant Isolation for Admins" ON tarefas;
END $$;

CREATE POLICY "Global Constraint: Tenant Isolation for Admins"
ON tarefas
AS RESTRICTIVE
FOR ALL
TO authenticated
USING (
    public.is_super_admin()
    OR 
    (
        CASE 
            WHEN public.is_admin() THEN 
                (
                    EXISTS (
                        SELECT 1 
                        FROM public.empresa_profissionais ep
                        WHERE ep.profissional_id = auth.uid()
                        AND ep.empresa_id = tarefas.empresa_id
                        AND ep.ativo = true
                    )
                    OR 
                    (created_by = auth.uid()) 
                )
            ELSE 
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
    public.is_super_admin()
    OR 
    (
        CASE 
            WHEN public.is_admin() THEN 
                (
                    EXISTS (
                        SELECT 1 
                        FROM public.tarefas t
                        JOIN public.empresa_profissionais ep ON t.empresa_id = ep.empresa_id
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
