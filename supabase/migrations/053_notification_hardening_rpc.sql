-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- MIGRATION 053: NOTIFICATION CENTER HARDENING (STAGES 1-3)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- STAGE 1: FUNCTIONAL FIX (MARK ALL AS READ)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE OR REPLACE FUNCTION mark_all_notifications_as_read(
    p_profissional_id UUID DEFAULT auth.uid()
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Security guard: Only self or admin can mark as read
    IF p_profissional_id != auth.uid()
       AND NOT EXISTS (
           SELECT 1
           FROM profissionais
           WHERE id = auth.uid()
             AND role = 'admin'
       )
    THEN
        RAISE EXCEPTION 'Unauthorized';
    END IF;

    -- Atomic update for all unread notifications
    UPDATE notifications
    SET read_at = NOW()
    WHERE profissional_id = p_profissional_id
      AND read_at IS NULL;
END;
$$;

COMMENT ON FUNCTION mark_all_notifications_as_read IS 'Atomic update to mark all notifications as read for a user.';

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- STAGE 2: ELIMINATION OF TIMEOUT RISK (BULK INSERT)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE OR REPLACE FUNCTION bulk_create_deadline_notifications(
    payloads JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    inserted_count INT;
BEGIN
    -- Bulk insert from JSONB array
    INSERT INTO notifications (
        profissional_id,
        tipo,
        mensagem,
        metadata,
        created_at
    )
    SELECT
        (p->>'profissional_id')::UUID,
        'deadline_reminder',
        p->>'message',
        p->'metadata',
        NOW()
    FROM jsonb_to_recordset(payloads) AS p(
        profissional_id TEXT,
        message TEXT,
        metadata JSONB
    );

    GET DIAGNOSTICS inserted_count = ROW_COUNT;

    RETURN jsonb_build_object(
        'inserted', inserted_count
    );
END;
$$;

COMMENT ON FUNCTION bulk_create_deadline_notifications IS 'Bulk insert for deadline notifications to avoid Edge Function timeouts.';

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- STAGE 3: RETENTION POLICY (CLEANUP)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE OR REPLACE FUNCTION cleanup_old_notifications()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    deleted_count INT;
BEGIN
    WITH deleted AS (
        DELETE FROM notifications
        WHERE
            -- 1. Garbage (Soft Deleted > 30 days)
            (cleared_at < NOW() - INTERVAL '30 days')
         OR 
            -- 2. Archive (Read > 90 days)
            (read_at < NOW() - INTERVAL '90 days')
         OR 
            -- 3. Zombies (Created > 1 year)
            (created_at < NOW() - INTERVAL '1 year')
        RETURNING id
    )
    SELECT COUNT(*) INTO deleted_count FROM deleted;

    RETURN deleted_count;
END;
$$;

COMMENT ON FUNCTION cleanup_old_notifications IS 'Cleanup policy: 30 days for cleared, 90 days for read, 1 year max retention.';

-- Optional: Schedule if pg_cron is available (commented out for manual activation)
-- SELECT cron.schedule(
--   'cleanup-notifications',
--   '0 3 * * *',
--   'SELECT cleanup_old_notifications()'
-- );
