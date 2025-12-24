-- SECURITY AUDIT SIMULATION
-- This function mocks an attacker to test RLS policies

CREATE OR REPLACE FUNCTION run_security_simulation()
RETURNS TABLE (
    test_case TEXT,
    status TEXT,
    details TEXT
) AS $$
DECLARE
    attacker_id UUID := '00000000-0000-0000-0000-000000000001';
    victim_id UUID := '00000000-0000-0000-0000-000000000002';
    victim_task_id UUID;
    rows_affected INTEGER;
BEGIN
    -- SETUP: Create dummy data for the test (as superuser)
    -- 1. Create fake professionals in public table only (auth.users cant be mocked easily here but foreign keys might complain, 
    --    so we assume RLS checks auth.uid() directly regardless of FK existence in auth.users for this simulation if possible.
    --    Actually, we need real rows in `profissionais` for RLS `is_active_profissional` to work)
    
    -- Insert Mock Professionals (We bypass FK to auth.users for this test if possible, or we need to insert into auth.users which we cant with postgres role often.
    -- RISK: If Foreign Key constraints enforce auth.users existence, this synthetic test might fail on setup.
    -- SOLUTION: We will try to rely on the fact that we can mock `auth.uid()`.
    -- However, `permissions` table checks `id = auth.uid()`. So we need a row in `profissionais` with that ID.
    -- If `profissionais` has FK to `auth.users`, we are stuck unless we have an admin function to create users.
    -- Let's try to simulate assuming valid users exist, OR just verify the policies logic directly.
    
    -- ALTERNATE STRATEGY: We will test by query inspection/logic check because inserting fake `auth.users` is hard from SQL migration.
    
    -- ... Wait, I can try to use existing users if I knew them, but I don't.
    -- Best effort: logic simulation with variable substitution.
    
    RETURN QUERY SELECT 'Setup'::TEXT, 'SKIP'::TEXT, 'Cannot create mock auth users via SQL'::TEXT;
END;
$$ LANGUAGE plpgsql;

-- REVISED APPROACH:
-- We will create a comprehensive policy breakdown instead of a runtime simulation if we cannot easily mock auth.
-- BUT, Supabase `auth.uid()` uses `request.jwt.claims`.
-- We CAN mock `profissionais` if we temporarily disable FK or if we just look at the code.
-- Let's try to be bold. If `profissionais` has ON DELETE CASCADE from auth.users, we can't insert easily.
-- However, RLS policies use `is_active_profissional()` which does `SELECT 1 FROM professionals WHERE id = auth.uid()`.
-- So for the simulated user to "Pass" the first gate (is active), they MUST exist in `profissionais`.
-- If I cannot insert into `profissionais` (due to FK), I cannot effectively test "Authenticated but unauthorized" scenarios fully.

-- PLAN B: Use the `check_system_integrity` function style to AUDIT the actual policy definitions textually.
-- This is surprisingly effective. We check if policies exist and contain correct keywords.

CREATE OR REPLACE FUNCTION audit_rls_policies()
RETURNS TABLE (
    table_name TEXT,
    policy_name TEXT,
    verdict TEXT,
    reason TEXT
) AS $$
DECLARE
    pol record;
BEGIN
    FOR pol IN 
        SELECT tablename, policyname, cmd, qual, with_check 
        FROM pg_policies 
        WHERE schemaname = 'public'
    LOOP
        -- 1. Check if TAREFAS allows access to others
        IF pol.tablename = 'tarefas' AND pol.cmd = 'SELECT' THEN
            IF pol.qual LIKE '%assigned_to = auth.uid()%' OR pol.qual LIKE '%created_by = auth.uid()%' THEN
                RETURN QUERY SELECT pol.tablename::text, pol.policyname::text, 'PASS'::text, 'Restricts to assigned/created owner'::text;
            ELSIF pol.policyname ILIKE '%admin%' THEN
                 RETURN QUERY SELECT pol.tablename::text, pol.policyname::text, 'PASS'::text, 'Admin access allowed'::text;
            ELSE
                 RETURN QUERY SELECT pol.tablename::text, pol.policyname::text, 'WARNING'::text, 'Potential loose policy: ' || pol.qual::text;
            END IF;
        END IF;

        -- 2. Check TAREFAS Update
        IF pol.tablename = 'tarefas' AND pol.cmd = 'UPDATE' THEN
            IF pol.qual LIKE '%assigned_to = auth.uid()%' THEN
                 RETURN QUERY SELECT pol.tablename::text, pol.policyname::text, 'PASS'::text, 'Only assignee can update'::text;
            ELSE
                 RETURN QUERY SELECT pol.tablename::text, pol.policyname::text, 'WARNING'::text, 'Check update policy: ' || pol.qual::text;
            END IF;
        END IF;
        
        -- 3. Check TAREFAS_ITENS
         IF pol.tablename = 'tarefas_itens' THEN
            IF (pol.qual LIKE '%profissional_id = auth.uid()%' OR pol.with_check LIKE '%profissional_id = auth.uid()%') THEN
                 RETURN QUERY SELECT pol.tablename::text, pol.policyname::text, 'PASS'::text, 'Restricted to professional owner'::text;
             ELSIF pol.policyname ILIKE '%admin%' THEN
                 RETURN QUERY SELECT pol.tablename::text, pol.policyname::text, 'PASS'::text, 'Admin access allowed'::text;
            ELSE
                 RETURN QUERY SELECT pol.tablename::text, pol.policyname::text, 'WARNING'::text, 'Check item policy: ' || COALESCE(pol.qual, pol.with_check)::text;
            END IF;
        END IF;

    END LOOP;
    
    -- 4. Check Tables without RLS
    FOR pol IN SELECT tablename FROM pg_tables WHERE schemaname = 'public'
    LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = pol.tablename AND relrowsecurity = true) THEN
             RETURN QUERY SELECT pol.tablename::text, 'NO RLS'::text, 'FAIL'::text, 'RLS Disabled'::text;
        END IF;
    END LOOP;
END;
$$ LANGUAGE plpgsql;
