-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- HARDENING 001: Multi-Tenant RLS Validation
-- Migration: 041_hardening_rls_multi_tenant.sql
-- Priority: CRITICAL
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 
-- PROBLEMA:
-- Policy "Service role creates micro tasks" permite INSERT sem validar tenant.
-- Staff ou Edge Function podem inserir micro-task em tarefa de outra empresa.
--
-- SOLUÇÃO:
-- Validar que profissional está vinculado à empresa da tarefa pai via
-- empresa_profissionais antes de permitir INSERT.
--
-- IMPACTO:
-- Zero breaking changes. Apenas restringe INSERTs inválidos que não deveriam
-- ocorrer. Fluxo normal de criação de OS não é afetado.
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 1. FIX tarefas_micro INSERT POLICY
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Drop existing permissive policy
DROP POLICY IF EXISTS "Service role creates micro tasks" ON tarefas_micro;

-- Create new restrictive policy with tenant validation
CREATE POLICY "Multi-tenant validated micro task insert"
    ON tarefas_micro FOR INSERT
    WITH CHECK (
        -- Validação 1: Tarefa pai existe e pertence a uma empresa
        EXISTS (
            SELECT 1 FROM tarefas t
            WHERE t.id = tarefa_id
            AND t.empresa_id IS NOT NULL
        )
        AND
        -- Validação 2: Profissional está vinculado à empresa da tarefa
        EXISTS (
            SELECT 1 FROM tarefas t
            INNER JOIN empresa_profissionais ep 
                ON ep.empresa_id = t.empresa_id
            WHERE t.id = tarefa_id
            AND ep.profissional_id = profissional_id
)
    );

COMMENT ON POLICY "Multi-tenant validated micro task insert" ON tarefas_micro IS 
'Hardening: Valida tenant antes de INSERT. Garante que profissional pertence à empresa da tarefa pai.';

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 2. FIX tarefas_micro_logs INSERT POLICY  
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Drop existing permissive policy
DROP POLICY IF EXISTS "Service role creates logs" ON tarefas_micro_logs;

-- Create new policy that validates via parent micro-task
CREATE POLICY "Validated micro task log insert"
    ON tarefas_micro_logs FOR INSERT
    WITH CHECK (
        -- Validação: Micro-task pai existe e pertence a tenant válido
        EXISTS (
            SELECT 1 FROM tarefas_micro tm
            INNER JOIN tarefas t ON t.id = tm.tarefa_id
            INNER JOIN empresa_profissionais ep ON ep.empresa_id = t.empresa_id
            WHERE tm.id = tarefa_micro_id
            AND (
                -- Log criado por profissional da empresa
                ep.profissional_id = COALESCE(from_profissional_id, to_profissional_id)
                -- Ou é log de sistema (ambos NULL)
                OR (from_profissional_id IS NULL AND to_profissional_id IS NULL)
            )
)
    );

COMMENT ON POLICY "Validated micro task log insert" ON tarefas_micro_logs IS 
'Hardening: Valida tenant antes de INSERT. Logs só podem ser criados para micro-tasks da empresa do profissional.';

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 3. ADD ADMIN BYPASS POLICIES (backward compatibility)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Ensure admin bypass exists for tarefas_micro
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'tarefas_micro' 
        AND policyname = 'Admin tem acesso total a tarefas_micro'
    ) THEN
        CREATE POLICY "Admin tem acesso total a tarefas_micro"
            ON tarefas_micro FOR ALL
            TO authenticated
            USING (
                EXISTS (
                    SELECT 1 FROM profissionais
                    WHERE id = auth.uid()
                    AND role = 'admin'
                )
            )
            WITH CHECK (
                EXISTS (
                    SELECT 1 FROM profissionais
                    WHERE id = auth.uid()
                    AND role = 'admin'
                )
            );
    END IF;
END $$;

-- Ensure admin bypass exists for tarefas_micro_logs
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'tarefas_micro_logs' 
        AND policyname = 'Admin tem acesso total a tarefas_micro_logs'
    ) THEN
        CREATE POLICY "Admin tem acesso total a tarefas_micro_logs"
            ON tarefas_micro_logs FOR ALL
            TO authenticated
            USING (
                EXISTS (
                    SELECT 1 FROM profissionais
                    WHERE id = auth.uid()
                    AND role = 'admin'
                )
            )
            WITH CHECK (
                EXISTS (
                    SELECT 1 FROM profissionais
                    WHERE id = auth.uid()
                    AND role = 'admin'
                )
            );
    END IF;
END $$;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 4. VERIFICATION QUERIES
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- View all RLS policies for tarefas_micro
-- SELECT * FROM pg_policies WHERE tablename = 'tarefas_micro';

-- View all RLS policies for tarefas_micro_logs  
-- SELECT * FROM pg_policies WHERE tablename = 'tarefas_micro_logs';

-- Test: Verify existing data still accessible
-- SELECT COUNT(*) FROM tarefas_micro;
-- SELECT COUNT(*) FROM tarefas_micro_logs;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- ROLLBACK INSTRUCTIONS (if needed)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
--
-- DROP POLICY "Multi-tenant validated micro task insert" ON tarefas_micro;
-- DROP POLICY "Validated micro task log insert" ON tarefas_micro_logs;
--
-- CREATE POLICY "Service role creates micro tasks"
--     ON tarefas_micro FOR INSERT
--     WITH CHECK (true);
--
-- CREATE POLICY "Service role creates logs"
--     ON tarefas_micro_logs FOR INSERT
--     WITH CHECK (true);
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
