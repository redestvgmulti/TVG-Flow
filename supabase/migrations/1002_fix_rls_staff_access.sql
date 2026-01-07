-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- Migration: Fix RLS for Staff Access (Visibility of Colleagues)
-- Data: 2026-01-07
-- Descrição: Permitir que colaboradores vejam outros membros da MESMA empresa
-- Necessário para o dropdown "Selecione um colaborador" funcionar
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

BEGIN;

-- 1. Habilitar RLS em empresa_profissionais (segurança extra, caso não esteja)
ALTER TABLE empresa_profissionais ENABLE ROW LEVEL SECURITY;

-- 2. Política: Ver membros da minha empresa em empresa_profissionais
-- "Eu posso ver registros em empresa_profissionais SE esses registros pertencerem 
-- a uma empresa que EU também faço parte (e estou ativo)"
DROP POLICY IF EXISTS "Ver membros da mesma empresa" ON empresa_profissionais;

CREATE POLICY "Ver membros da mesma empresa"
ON empresa_profissionais FOR SELECT
USING (
  empresa_id IN (
    SELECT ep.empresa_id 
    FROM empresa_profissionais ep 
    WHERE ep.profissional_id = auth.uid()
    AND ep.ativo = true
  )
);

-- 3. Política: Ver detalhes de profissionais da minha empresa
-- "Eu posso ver dados básicos (nome, id) de profissionais que estão em
-- empresas que eu também estou"
DROP POLICY IF EXISTS "Ver colegas da mesma empresa" ON profissionais;

CREATE POLICY "Ver colegas da mesma empresa"
ON profissionais FOR SELECT
USING (
  id IN (
    SELECT ep_colleague.profissional_id
    FROM empresa_profissionais ep_colleague
    WHERE ep_colleague.empresa_id IN (
        -- Minhas empresas
        SELECT ep_me.empresa_id 
        FROM empresa_profissionais ep_me 
        WHERE ep_me.profissional_id = auth.uid() 
        AND ep_me.ativo = true
    )
  )
);

-- Log
DO $$
BEGIN
    RAISE NOTICE 'Policies for staff visibility applied successfully.';
END $$;

COMMIT;
