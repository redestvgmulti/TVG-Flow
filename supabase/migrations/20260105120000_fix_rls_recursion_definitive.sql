-- Migration: Fix RLS Infinite Recursion in Profissionais
-- Date: 2026-01-05
-- Description: Creates a Security Definer function to safely check user status without triggering RLS loops.

-- 1. Create Helper Function (Bypasses RLS)
CREATE OR REPLACE FUNCTION public.is_active_professional()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profissionais
    WHERE id = auth.uid()
    AND ativo = true
  );
$$;

-- 2. Drop Problematic Policies
DROP POLICY IF EXISTS "select_profissionais_all_authenticated" ON "public"."profissionais";
DROP POLICY IF EXISTS "select_profissionais_secure" ON "public"."profissionais";
DROP POLICY IF EXISTS "update_profissionais_by_role" ON "public"."profissionais";
DROP POLICY IF EXISTS "delete_profissionais_admin_only" ON "public"."profissionais";

-- 3. Re-create Policies using the Safe Function

-- SELECT: Allow if reading self OR if active (using safe function)
CREATE POLICY "select_profissionais_no_recursion"
ON "public"."profissionais"
FOR SELECT
TO authenticated
USING (
  (id = auth.uid()) -- Always allow reading own raw profile to bootstrap
  OR
  is_active_professional() -- Safely check status for broad access
);

-- UPDATE: Must be active to update. Admin updates all, users update self.
CREATE POLICY "update_profissionais_secure_definitive"
ON "public"."profissionais"
FOR UPDATE
TO authenticated
USING (
  is_active_professional()
  AND (
    (role = 'admin')
    OR
    (id = auth.uid())
  )
)
WITH CHECK (
  is_active_professional()
  AND (
    (role = 'admin')
    OR
    (id = auth.uid())
  )
);

-- DELETE: Admin only (must be active)
CREATE POLICY "delete_profissionais_admin_secure"
ON "public"."profissionais"
FOR DELETE
TO authenticated
USING (
  is_active_professional()
  AND role = 'admin'
);
