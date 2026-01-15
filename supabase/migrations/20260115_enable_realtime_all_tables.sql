-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- Enable Realtime for All Required Tables
-- Ensures tarefas, tarefas_micro, and notifications support real-time subscriptions
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 1. NOTIFICATIONS TABLE
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Enable realtime publication for notifications table (if not already)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' 
        AND tablename = 'notifications'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
    END IF;
END $$;

-- Set REPLICA IDENTITY to FULL
ALTER TABLE notifications REPLICA IDENTITY FULL;

COMMENT ON TABLE notifications IS 'Notifications table with Realtime enabled for instant updates';

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 2. TAREFAS TABLE (Used by Sidebar for task count updates)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Enable realtime publication for tarefas table
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' 
        AND tablename = 'tarefas'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE tarefas;
    END IF;
END $$;

-- Set REPLICA IDENTITY to FULL
ALTER TABLE tarefas REPLICA IDENTITY FULL;

COMMENT ON TABLE tarefas IS 'Macro tasks table with Realtime enabled for status updates';

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 3. TAREFAS_MICRO TABLE (Used by OperationalFeed for activity stream)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Enable realtime publication for tarefas_micro table
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' 
        AND tablename = 'tarefas_micro'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE tarefas_micro;
    END IF;
END $$;

-- Set REPLICA IDENTITY to FULL
ALTER TABLE tarefas_micro REPLICA IDENTITY FULL;

COMMENT ON TABLE tarefas_micro IS 'Micro tasks table with Realtime enabled for activity feed';

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- VERIFICATION
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- List all tables with Realtime enabled
DO $$
DECLARE
    rec record;
BEGIN
    RAISE NOTICE '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
    RAISE NOTICE 'REALTIME ENABLED TABLES:';
    RAISE NOTICE '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
    
    FOR rec IN 
        SELECT schemaname, tablename 
        FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime'
        ORDER BY tablename
    LOOP
        RAISE NOTICE '✓ %.%', rec.schemaname, rec.tablename;
    END LOOP;
    
    RAISE NOTICE '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
END $$;
