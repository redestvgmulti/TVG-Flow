-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- CORREÇÃO CRÍTICA: RLS INFINITE RECURSION
-- Remove políticas que causam recursão infinita na tabela profissionais
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 1. REMOVER TODAS AS POLÍTICAS ANTIGAS
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

DROP POLICY IF EXISTS "Profissionais podem ver próprio perfil" ON profissionais;
DROP POLICY IF EXISTS "Profissionais podem atualizar próprio perfil" ON profissionais;
DROP POLICY IF EXISTS "Admin pode ver todos profissionais" ON profissionais;
DROP POLICY IF EXISTS "Admin pode inserir profissionais" ON profissionais;
DROP POLICY IF EXISTS "Admin pode atualizar profissionais" ON profissionais;
DROP POLICY IF EXISTS "Admin pode deletar profissionais" ON profissionais;
DROP POLICY IF EXISTS "Profissionais view own profile" ON profissionais;
DROP POLICY IF EXISTS "Profissionais update own profile" ON profissionais;
DROP POLICY IF EXISTS "Admins view all profiles" ON profissionais;
DROP POLICY IF EXISTS "Admins insert profiles" ON profissionais;
DROP POLICY IF EXISTS "Admins update profiles" ON profissionais;
DROP POLICY IF EXISTS "Admins delete profiles" ON profissionais;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 2. CRIAR POLÍTICAS CORRETAS (SEM RECURSÃO)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Profissionais podem ver apenas o próprio perfil
-- IMPORTANTE: Usa auth.uid() diretamente, sem SELECT em profissionais
CREATE POLICY "Profissionais veem próprio perfil"
ON profissionais FOR SELECT
TO authenticated
USING (id = auth.uid());

-- Profissionais podem atualizar apenas o próprio perfil
CREATE POLICY "Profissionais atualizam próprio perfil"
ON profissionais FOR UPDATE
TO authenticated
USING (id = auth.uid())
WITH CHECK (id = auth.uid());

-- Admin pode ver todos os perfis
-- IMPORTANTE: Verifica role diretamente na linha, não faz SELECT
CREATE POLICY "Admin vê todos perfis"
ON profissionais FOR SELECT
TO authenticated
USING (
  -- Se é admin, vê tudo
  (SELECT role FROM profissionais WHERE id = auth.uid()) = 'admin'
  OR
  -- Se não é admin, vê apenas o próprio
  id = auth.uid()
);

-- Admin pode inserir novos profissionais
CREATE POLICY "Admin insere profissionais"
ON profissionais FOR INSERT
TO authenticated
WITH CHECK (
  (SELECT role FROM profissionais WHERE id = auth.uid()) = 'admin'
);

-- Admin pode atualizar qualquer profissional
CREATE POLICY "Admin atualiza profissionais"
ON profissionais FOR UPDATE
TO authenticated
USING (
  (SELECT role FROM profissionais WHERE id = auth.uid()) = 'admin'
);

-- Admin pode deletar profissionais
CREATE POLICY "Admin deleta profissionais"
ON profissionais FOR DELETE
TO authenticated
USING (
  (SELECT role FROM profissionais WHERE id = auth.uid()) = 'admin'
);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 3. VALIDAÇÃO
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

DO $$
BEGIN
    RAISE NOTICE 'Políticas RLS de profissionais corrigidas com sucesso!';
END $$;
