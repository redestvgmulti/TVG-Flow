-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- Migration: Definitively Break RLS Recursion
-- Data: 2026-01-07
-- Descrição: Substituir a lógica de subquery RLS por uma função SECURITY DEFINER
-- completa, evitando qualquer verificação de policy durante o filtro de colegas.
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

BEGIN;

-- 1. Helper Function: Obter IDs de colegas visíveis (SECURITY DEFINER)
-- Retorna IDs de todos os profissionais que estão nas mesmas empresas que o usuário
CREATE OR REPLACE FUNCTION get_visible_colleagues()
RETURNS SETOF uuid
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT DISTINCT ep_target.profissional_id
  FROM empresa_profissionais ep_target
  WHERE ep_target.empresa_id IN (
    SELECT ep_me.empresa_id
    FROM empresa_profissionais ep_me
    WHERE ep_me.profissional_id = auth.uid()
    AND ep_me.profissional_id = auth.uid()
  );
END;
$$ LANGUAGE plpgsql;

-- 1.1 Helper Function: Check Admin Safe (SECURITY DEFINER)
-- Evita recursão ao verificar se é admin
CREATE OR REPLACE FUNCTION is_admin_safe()
RETURNS BOOLEAN
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM profissionais
    WHERE id = auth.uid()
    AND role = 'admin'
    AND ativo = true
  );
END;
$$ LANGUAGE plpgsql;

-- 2. Atualizar Policy em 'profissionais'
DROP POLICY IF EXISTS "Ver colegas da mesma empresa" ON profissionais;

CREATE POLICY "Ver colegas da mesma empresa"
ON profissionais FOR SELECT
USING (
  id IN ( SELECT get_visible_colleagues() )
);

-- 3. Limpar e Recriar Policies de 'empresa_profissionais'
DO $$ 
DECLARE 
  r RECORD; 
BEGIN 
  FOR r IN (SELECT policyname FROM pg_policies WHERE tablename = 'empresa_profissionais') LOOP 
    EXECUTE 'DROP POLICY IF EXISTS "' || r.policyname || '" ON empresa_profissionais'; 
  END LOOP; 
END $$;

-- 3.1 Admin: Acesso total (usando função SAFE)
CREATE POLICY "Admin Total Access"
ON empresa_profissionais FOR ALL
USING (is_admin_safe());

-- 3.2 Staff: Ver membros das minhas empresas
CREATE POLICY "Staff Ver Membros Mesma Empresa"
ON empresa_profissionais FOR SELECT
USING (
   empresa_id IN ( SELECT get_my_company_ids() )
);

-- Log
DO $$
BEGIN
    RAISE NOTICE 'Recursion loop broken via Function encapsulation + Safe Admin check.';
END $$;

COMMIT;
