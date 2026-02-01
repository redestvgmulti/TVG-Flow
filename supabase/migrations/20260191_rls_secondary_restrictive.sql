-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- MIGRATION: RLS HARDENING PHASE 3 (SECONDARY TABLES ISOLATION)
-- DATE: 2026-01-23
-- DESCRIPTION: Applies "AS RESTRICTIVE" policies to enforce tenant isolation
-- on secondary tables (logs, attachments) linked to tasks.
-- Admins can only see records linked to tasks from their own companies.
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 1. HARDEN TABLE: LOGS_TAREFAS
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

DO $$
BEGIN
    DROP POLICY IF EXISTS "Global Constraint: Tenant Isolation for Logs" ON logs_tarefas;
END $$;

CREATE POLICY "Global Constraint: Tenant Isolation for Logs"
ON logs_tarefas
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
                        WHERE t.id = logs_tarefas.tarefa_id
                        AND ep.profissional_id = auth.uid()
)
                )
            ELSE 
                TRUE
        END
    )
);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 2. HARDEN TABLE: ARQUIVOS_TAREFAS (Task Attachments)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

DO $$
BEGIN
    DROP POLICY IF EXISTS "Global Constraint: Tenant Isolation for Files" ON arquivos_tarefas;
END $$;

CREATE POLICY "Global Constraint: Tenant Isolation for Files"
ON arquivos_tarefas
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
                        WHERE t.id = arquivos_tarefas.tarefa_id
                        AND ep.profissional_id = auth.uid()
)
                )
            ELSE 
                TRUE
        END
    )
);
