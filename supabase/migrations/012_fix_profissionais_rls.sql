-- Fix RLS policies for profissionais table
-- The issue: auth.jwt() ->> 'role' doesn't exist in the JWT
-- We need to check the role from the profissionais table itself

-- Drop existing policies
DROP POLICY IF EXISTS "select_profissionais_secure" ON "public"."profissionais";
DROP POLICY IF EXISTS "insert_profissionais_admin_only" ON "public"."profissionais";
DROP POLICY IF EXISTS "update_profissionais_secure" ON "public"."profissionais";
DROP POLICY IF EXISTS "delete_profissionais_admin_only" ON "public"."profissionais";

-- SELECT: Admins see all, professionals see all (for collaboration)
-- This allows the professionals list page to work for all authenticated users
CREATE POLICY "select_profissionais_all_authenticated"
ON "public"."profissionais"
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profissionais
    WHERE id = auth.uid()
    AND ativo = true
  )
);

-- INSERT: Only service role (Edge Functions) can insert
CREATE POLICY "insert_profissionais_service_role"
ON "public"."profissionais"
FOR INSERT
TO service_role
WITH CHECK (true);

-- UPDATE: Admins can update all, professionals can update self
CREATE POLICY "update_profissionais_by_role"
ON "public"."profissionais"
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profissionais p
    WHERE p.id = auth.uid()
    AND p.ativo = true
    AND (
      p.role = 'admin'
      OR profissionais.id = auth.uid()
    )
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM profissionais p
    WHERE p.id = auth.uid()
    AND p.ativo = true
    AND (
      p.role = 'admin'
      OR profissionais.id = auth.uid()
    )
  )
);

-- DELETE: Only admins can delete
CREATE POLICY "delete_profissionais_admin_only"
ON "public"."profissionais"
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profissionais
    WHERE id = auth.uid()
    AND role = 'admin'
    AND ativo = true
  )
);
