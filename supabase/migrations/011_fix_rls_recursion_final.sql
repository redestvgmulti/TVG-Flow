-- Migration script to fix RLS recursion on 'profissionais' table

-- 1. Drop existing policies to ensure a clean slate and remove recursion
DROP POLICY IF EXISTS "Admin acesso total profissionais" ON "public"."profissionais";
DROP POLICY IF EXISTS "Profissionais veem a si mesmos" ON "public"."profissionais";
DROP POLICY IF EXISTS "Admin pode gerenciar profissionais" ON "public"."profissionais";
DROP POLICY IF EXISTS "Read professionals safely" ON "public"."profissionais";
DROP POLICY IF EXISTS "Admin manages professionals" ON "public"."profissionais";
DROP POLICY IF EXISTS "Enable read access for authenticated users" ON "public"."profissionais";
DROP POLICY IF EXISTS "Enable insert for authenticated users" ON "public"."profissionais";
DROP POLICY IF EXISTS "Enable update for users based on email" ON "public"."profissionais";

-- 2. Create new secure, non-recursive policies

-- SELECT: Admin sees all, Professional sees self
CREATE POLICY "select_profissionais_secure"
ON "public"."profissionais"
FOR SELECT
USING (
  (auth.jwt() ->> 'role'::text) = 'admin'::text
  OR id = auth.uid()
);

-- INSERT: Only Admin can create professionals
CREATE POLICY "insert_profissionais_admin_only"
ON "public"."profissionais"
FOR INSERT
WITH CHECK (
  (auth.jwt() ->> 'role'::text) = 'admin'::text
);

-- UPDATE: Admin can update all, Professional can update self
CREATE POLICY "update_profissionais_secure"
ON "public"."profissionais"
FOR UPDATE
USING (
  (auth.jwt() ->> 'role'::text) = 'admin'::text
  OR id = auth.uid()
)
WITH CHECK (
  (auth.jwt() ->> 'role'::text) = 'admin'::text
  OR id = auth.uid()
);

-- DELETE: Only Admin can delete professionals
CREATE POLICY "delete_profissionais_admin_only"
ON "public"."profissionais"
FOR DELETE
USING (
  (auth.jwt() ->> 'role'::text) = 'admin'::text
);
