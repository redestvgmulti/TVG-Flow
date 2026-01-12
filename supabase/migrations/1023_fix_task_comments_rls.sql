-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- Migration 1023: Correction RLS Task Comments (Defensive Trigger)
-- Date: 2026-01-12
-- Description: Creates a BEFORE INSERT trigger to ensure author_id matches
-- auth.uid() preventing RLS violations if frontend/triggers send wrong ID.
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

BEGIN;

-- 1. Create Defensive Function
CREATE OR REPLACE FUNCTION fix_comment_author_id()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- If user is authenticated
    IF auth.uid() IS NOT NULL THEN
        -- Allow admin to impersonate (optional, strictly typically admins also use their own ID)
        -- But for safety, we enforce auth.uid() for everyone unless logic dictates otherwise.
        -- Let's check is_admin_safe for exception? NO. 
        -- RLS policy "Criar comentário na OS" STRICTLY requires author_id = auth.uid().
        -- So we MUST set it to auth.uid().
        
        IF NEW.author_id != auth.uid() THEN
            NEW.author_id := auth.uid();
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. Create Trigger
DROP TRIGGER IF EXISTS trg_fix_comment_author_before_insert ON task_comments;
CREATE TRIGGER trg_fix_comment_author_before_insert
    BEFORE INSERT ON task_comments
    FOR EACH ROW
    EXECUTE FUNCTION fix_comment_author_id();

-- 3. Log
DO $$
BEGIN
    RAISE NOTICE '✅ Migration 1023: Trigger trg_fix_comment_author_before_insert created.';
END $$;

COMMIT;
