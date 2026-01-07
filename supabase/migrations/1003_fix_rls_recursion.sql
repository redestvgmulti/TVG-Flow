-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- Migration: Fix RLS Recursion (Infinite Loop)
-- Data: 2026-01-07
-- Descrição: Corrigir erro 500 causado por recursão infinita nas policies
-- Solução: Usar função SECURITY DEFINER para buscar empresas do usuário
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

BEGIN;

-- 1. Helper Function SECURITY DEFINER (Bypassa RLS)
-- Retorna os IDs das empresas onde o usuário atual é membro ativo
CREATE OR REPLACE FUNCTION get_my_company_ids()
RETURNS SETOF uuid
SECURITY DEFINER
SET search_path = public -- Segurança: sempre definir search_path
AS $$
BEGIN
  RETURN QUERY 
  SELECT ep.empresa_id 
  FROM empresa_profissionais ep 
  WHERE ep.profissional_id = auth.uid() 
  AND ep.ativo = true;
END;
$$ LANGUAGE plpgsql;

-- 2. Corrigir Política de empresa_profissionais
DROP POLICY IF EXISTS "Ver membros da mesma empresa" ON empresa_profissionais;

CREATE POLICY "Ver membros da mesma empresa"
ON empresa_profissionais FOR SELECT
USING (
  empresa_id IN ( SELECT get_my_company_ids() )
);

-- 3. Corrigir Política de profissionais
DROP POLICY IF EXISTS "Ver colegas da mesma empresa" ON profissionais;

CREATE POLICY "Ver colegas da mesma empresa"
ON profissionais FOR SELECT
USING (
  id IN (
    SELECT ep.profissional_id
    FROM empresa_profissionais ep
    WHERE ep.empresa_id IN ( SELECT get_my_company_ids() )
  )
);

-- Log
DO $$
BEGIN
    RAISE NOTICE 'RLS recursion fixed using SECURITY DEFINER function.';
END $$;

COMMIT;
