-- Migration: Create schema migrations control and integrity checks
-- Description: Production hardening - migration tracking and system integrity validation

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 1. SCHEMA MIGRATIONS CONTROL TABLE
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE TABLE IF NOT EXISTS schema_migrations (
    id SERIAL PRIMARY KEY,
    migration_name TEXT UNIQUE NOT NULL,
    applied_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Register all critical migrations
INSERT INTO schema_migrations (migration_name) VALUES
    ('021_create_empresas'),
    ('022_create_empresa_profissionais'),
    ('023_create_tarefas_itens'),
    ('024_create_tarefas_itens_historico'),
    ('025_add_empresa_to_tarefas'),
    ('026_migrate_deadline_datetime'),
    ('027_fix_microtasks_profissionais_status'),
    ('028_production_hardening')
ON CONFLICT (migration_name) DO NOTHING;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 2. SYSTEM INTEGRITY CHECK FUNCTION
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE OR REPLACE FUNCTION check_system_integrity()
RETURNS TABLE (
    status TEXT,
    missing_migrations TEXT[],
    missing_tables TEXT[],
    missing_triggers TEXT[],
    missing_constraints TEXT[],
    rls_issues TEXT[],
    message TEXT
) AS $$
DECLARE
    required_migrations TEXT[] := ARRAY[
        '021_create_empresas',
        '022_create_empresa_profissionais',
        '023_create_tarefas_itens',
        '024_create_tarefas_itens_historico',
        '025_add_empresa_to_tarefas',
        '026_migrate_deadline_datetime',
        '027_fix_microtasks_profissionais_status'
    ];
    required_tables TEXT[] := ARRAY[
        'empresas',
        'empresa_profissionais',
        'tarefas_itens',
        'tarefas_itens_historico'
    ];
    required_triggers TEXT[] := ARRAY[
        'trigger_update_tarefa_status_after_item_change',
        'trigger_log_tarefas_itens_changes',
        'trigger_set_tarefas_itens_concluida_at'
    ];
    v_missing_migrations TEXT[] := '{}';
    v_missing_tables TEXT[] := '{}';
    v_missing_triggers TEXT[] := '{}';
    v_missing_constraints TEXT[] := '{}';
    v_rls_issues TEXT[] := '{}';
    v_status TEXT := 'OK';
    v_message TEXT := 'Sistema íntegro e pronto para produção';
    migration_name TEXT;
    table_name TEXT;
    trigger_name TEXT;
BEGIN
    -- Check migrations
    FOREACH migration_name IN ARRAY required_migrations LOOP
        IF NOT EXISTS (
            SELECT 1 FROM schema_migrations WHERE migration_name = migration_name
        ) THEN
            v_missing_migrations := array_append(v_missing_migrations, migration_name);
            v_status := 'ERROR';
        END IF;
    END LOOP;

    -- Check tables
    FOREACH table_name IN ARRAY required_tables LOOP
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.tables 
            WHERE table_schema = 'public' AND table_name = table_name
        ) THEN
            v_missing_tables := array_append(v_missing_tables, table_name);
            v_status := 'ERROR';
        END IF;
    END LOOP;

    -- Check triggers
    FOREACH trigger_name IN ARRAY required_triggers LOOP
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.triggers 
            WHERE trigger_name = trigger_name
        ) THEN
            v_missing_triggers := array_append(v_missing_triggers, trigger_name);
            v_status := 'ERROR';
        END IF;
    END LOOP;

    -- Check critical constraints
    IF EXISTS (SELECT 1 FROM tarefas_itens LIMIT 1) THEN
        -- Check status constraint
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.check_constraints
            WHERE constraint_name = 'tarefas_itens_status_check'
        ) THEN
            v_missing_constraints := array_append(v_missing_constraints, 'tarefas_itens_status_check');
            v_status := 'ERROR';
        END IF;

        -- Check FK to profissionais
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.table_constraints
            WHERE constraint_name = 'tarefas_itens_profissional_id_fkey'
            AND table_name = 'tarefas_itens'
        ) THEN
            v_missing_constraints := array_append(v_missing_constraints, 'tarefas_itens_profissional_id_fkey');
            v_status := 'ERROR';
        END IF;
    END IF;

    -- Check RLS is enabled on critical tables
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE relname = 'tarefas_itens') THEN
        v_rls_issues := array_append(v_rls_issues, 'tarefas_itens: RLS not enabled');
        v_status := 'ERROR';
    END IF;

    IF NOT (SELECT relrowsecurity FROM pg_class WHERE relname = 'empresas') THEN
        v_rls_issues := array_append(v_rls_issues, 'empresas: RLS not enabled');
        v_status := 'ERROR';
    END IF;

    -- Build error message if needed
    IF v_status = 'ERROR' THEN
        v_message := 'Sistema inconsistente: migrations obrigatórias não aplicadas ou configuração incorreta';
    END IF;

    RETURN QUERY SELECT 
        v_status,
        v_missing_migrations,
        v_missing_tables,
        v_missing_triggers,
        v_missing_constraints,
        v_rls_issues,
        v_message;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 3. DATA INTEGRITY CHECKS
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE OR REPLACE FUNCTION check_data_integrity()
RETURNS TABLE (
    check_name TEXT,
    status TEXT,
    issue_count INTEGER,
    details TEXT
) AS $$
BEGIN
    -- Check 1: Orphaned micro-tasks (without macro task)
    RETURN QUERY
    SELECT 
        'orphaned_microtasks'::TEXT,
        CASE WHEN COUNT(*) = 0 THEN 'OK' ELSE 'WARNING' END::TEXT,
        COUNT(*)::INTEGER,
        'Micro-tarefas sem tarefa macro'::TEXT
    FROM tarefas_itens ti
    WHERE NOT EXISTS (SELECT 1 FROM tarefas t WHERE t.id = ti.tarefa_id);

    -- Check 2: Micro-tasks assigned to professionals outside company
    RETURN QUERY
    SELECT 
        'invalid_company_assignments'::TEXT,
        CASE WHEN COUNT(*) = 0 THEN 'OK' ELSE 'ERROR' END::TEXT,
        COUNT(*)::INTEGER,
        'Micro-tarefas atribuídas a profissionais fora da empresa'::TEXT
    FROM tarefas_itens ti
    INNER JOIN tarefas t ON t.id = ti.tarefa_id
    WHERE t.empresa_id IS NOT NULL
    AND NOT EXISTS (
        SELECT 1 FROM empresa_profissionais ep
        WHERE ep.empresa_id = t.empresa_id
        AND ep.profissional_id = ti.profissional_id
    );

    -- Check 3: Completed tasks with pending micro-tasks
    RETURN QUERY
    SELECT 
        'completed_with_pending'::TEXT,
        CASE WHEN COUNT(*) = 0 THEN 'OK' ELSE 'WARNING' END::TEXT,
        COUNT(*)::INTEGER,
        'Tarefas concluídas com micro-tarefas pendentes'::TEXT
    FROM tarefas t
    WHERE t.status = 'concluida'
    AND EXISTS (
        SELECT 1 FROM tarefas_itens ti
        WHERE ti.tarefa_id = t.id
        AND ti.status = 'pendente'
    );

    -- Check 4: Invalid status values
    RETURN QUERY
    SELECT 
        'invalid_status_values'::TEXT,
        CASE WHEN COUNT(*) = 0 THEN 'OK' ELSE 'ERROR' END::TEXT,
        COUNT(*)::INTEGER,
        'Status inválidos fora do enum permitido'::TEXT
    FROM tarefas_itens
    WHERE status NOT IN ('pendente', 'concluida');

    -- Check 5: Tasks without deadline (if required by business logic)
    RETURN QUERY
    SELECT 
        'missing_deadlines'::TEXT,
        CASE WHEN COUNT(*) = 0 THEN 'OK' ELSE 'WARNING' END::TEXT,
        COUNT(*)::INTEGER,
        'Tarefas sem deadline definido'::TEXT
    FROM tarefas
    WHERE deadline_at IS NULL
    AND status != 'concluida';

END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 4. TRIGGER HARDENING - Prevent unnecessary updates
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Improved trigger: only update if status actually changes
CREATE OR REPLACE FUNCTION update_tarefa_status_from_itens()
RETURNS TRIGGER AS $$
DECLARE
    total_itens INTEGER;
    concluidas_itens INTEGER;
    target_tarefa_id UUID;
    current_status TEXT;
    new_status TEXT;
BEGIN
    target_tarefa_id := COALESCE(NEW.tarefa_id, OLD.tarefa_id);
    
    -- Get current status
    SELECT status INTO current_status
    FROM tarefas
    WHERE id = target_tarefa_id;
    
    -- Count micro-tasks
    SELECT 
        COUNT(*),
        COUNT(*) FILTER (WHERE status = 'concluida')
    INTO total_itens, concluidas_itens
    FROM tarefas_itens
    WHERE tarefa_id = target_tarefa_id;
    
    -- If no micro-tasks, don't change status
    IF total_itens = 0 THEN
        RETURN COALESCE(NEW, OLD);
    END IF;
    
    -- Determine new status
    IF concluidas_itens = total_itens THEN
        new_status := 'concluida';
    ELSIF concluidas_itens > 0 AND concluidas_itens < total_itens THEN
        new_status := 'em_progresso';
    ELSE
        new_status := 'pendente';
    END IF;
    
    -- HARDENING: Only update if status actually changes
    IF current_status IS DISTINCT FROM new_status THEN
        UPDATE tarefas
        SET status = new_status,
            updated_at = now()
        WHERE id = target_tarefa_id;
    END IF;
    
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 5. PRODUCTION CHECKLIST FUNCTION
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE OR REPLACE FUNCTION production_checklist()
RETURNS TABLE (
    category TEXT,
    item TEXT,
    status TEXT,
    details TEXT
) AS $$
BEGIN
    -- Migrations
    RETURN QUERY
    SELECT 
        'Migrations'::TEXT,
        'Critical migrations applied'::TEXT,
        CASE WHEN COUNT(*) >= 7 THEN '✅' ELSE '❌' END::TEXT,
        COUNT(*)::TEXT || ' of 7 applied'::TEXT
    FROM schema_migrations
    WHERE migration_name LIKE '02%';

    -- Triggers
    RETURN QUERY
    SELECT 
        'Triggers'::TEXT,
        'Auto-status update trigger'::TEXT,
        CASE WHEN EXISTS (
            SELECT 1 FROM information_schema.triggers 
            WHERE trigger_name = 'trigger_update_tarefa_status_after_item_change'
        ) THEN '✅' ELSE '❌' END::TEXT,
        ''::TEXT;

    RETURN QUERY
    SELECT 
        'Triggers'::TEXT,
        'Audit trail trigger'::TEXT,
        CASE WHEN EXISTS (
            SELECT 1 FROM information_schema.triggers 
            WHERE trigger_name = 'trigger_log_tarefas_itens_changes'
        ) THEN '✅' ELSE '❌' END::TEXT,
        ''::TEXT;

    -- RLS
    RETURN QUERY
    SELECT 
        'RLS'::TEXT,
        'tarefas_itens RLS enabled'::TEXT,
        CASE WHEN (SELECT relrowsecurity FROM pg_class WHERE relname = 'tarefas_itens') 
            THEN '✅' ELSE '❌' END::TEXT,
        ''::TEXT;

    RETURN QUERY
    SELECT 
        'RLS'::TEXT,
        'empresas RLS enabled'::TEXT,
        CASE WHEN (SELECT relrowsecurity FROM pg_class WHERE relname = 'empresas') 
            THEN '✅' ELSE '❌' END::TEXT,
        ''::TEXT;

    -- Constraints
    RETURN QUERY
    SELECT 
        'Constraints'::TEXT,
        'Status constraint (pt-BR)'::TEXT,
        CASE WHEN EXISTS (
            SELECT 1 FROM information_schema.check_constraints
            WHERE constraint_name = 'tarefas_itens_status_check'
        ) THEN '✅' ELSE '❌' END::TEXT,
        ''::TEXT;

    RETURN QUERY
    SELECT 
        'Constraints'::TEXT,
        'FK to profissionais'::TEXT,
        CASE WHEN EXISTS (
            SELECT 1 FROM information_schema.table_constraints
            WHERE constraint_name = 'tarefas_itens_profissional_id_fkey'
        ) THEN '✅' ELSE '❌' END::TEXT,
        ''::TEXT;

END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 6. GRANT PERMISSIONS
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Allow authenticated users to check system integrity
GRANT EXECUTE ON FUNCTION check_system_integrity() TO authenticated;
GRANT EXECUTE ON FUNCTION check_data_integrity() TO authenticated;
GRANT EXECUTE ON FUNCTION production_checklist() TO authenticated;

-- Comments
COMMENT ON TABLE schema_migrations IS 'Tracks applied database migrations for integrity validation';
COMMENT ON FUNCTION check_system_integrity() IS 'Validates that all critical migrations and configurations are in place';
COMMENT ON FUNCTION check_data_integrity() IS 'Checks for data inconsistencies and business rule violations';
COMMENT ON FUNCTION production_checklist() IS 'Automated production readiness checklist';

-- Register this migration
INSERT INTO schema_migrations (migration_name)
VALUES ('028_production_hardening')
ON CONFLICT DO NOTHING;
