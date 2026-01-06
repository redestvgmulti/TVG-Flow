-- Migration: Fix null roles for existing users
-- This migration sets a default 'staff' role for any professional without a role assigned

-- First, let's see how many users are affected
DO $$
DECLARE
    affected_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO affected_count
    FROM profissionais
    WHERE role IS NULL;
    
    RAISE NOTICE 'Found % users with NULL role', affected_count;
END $$;

-- Update all users with NULL role to 'staff' (safest default)
-- Admins should be manually promoted after this migration
UPDATE profissionais
SET role = 'staff'
WHERE role IS NULL;

-- Verify the fix
SELECT 
    COUNT(*) as total_users,
    COUNT(CASE WHEN role IS NULL THEN 1 END) as null_roles,
    COUNT(CASE WHEN role = 'staff' THEN 1 END) as staff_count,
    COUNT(CASE WHEN role = 'admin' THEN 1 END) as admin_count,
    COUNT(CASE WHEN role = 'super_admin' THEN 1 END) as super_admin_count
FROM profissionais;
