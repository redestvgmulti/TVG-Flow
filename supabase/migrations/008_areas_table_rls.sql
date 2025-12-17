-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- CORREÇÃO: TABELA AREAS COM RLS
-- Garantir que a tabela areas existe e tem políticas de segurança corretas
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 1. CRIAR TABELA AREAS (SE NÃO EXISTIR)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE TABLE IF NOT EXISTS public.areas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL,
  ativo BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Índice para buscas
CREATE INDEX IF NOT EXISTS idx_areas_ativo ON public.areas(ativo);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 2. HABILITAR RLS
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ALTER TABLE public.areas ENABLE ROW LEVEL SECURITY;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 3. REMOVER POLÍTICAS ANTIGAS (SE EXISTIREM)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

DROP POLICY IF EXISTS "Admins manage areas" ON public.areas;
DROP POLICY IF EXISTS "Admin acesso total areas" ON public.areas;
DROP POLICY IF EXISTS "Profissionais veem areas" ON public.areas;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 4. POLÍTICAS DE SEGURANÇA
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Admin: acesso total (SELECT, INSERT, UPDATE, DELETE)
CREATE POLICY "Admin acesso total areas"
ON public.areas
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profissionais
    WHERE profissionais.id = auth.uid()
      AND profissionais.role = 'admin'
      AND profissionais.ativo = true
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM profissionais
    WHERE profissionais.id = auth.uid()
      AND profissionais.role = 'admin'
      AND profissionais.ativo = true
  )
);

-- Profissionais: apenas leitura de áreas ativas
CREATE POLICY "Profissionais veem areas ativas"
ON public.areas
FOR SELECT
TO authenticated
USING (
  ativo = true
  AND EXISTS (
    SELECT 1 FROM profissionais
    WHERE profissionais.id = auth.uid()
      AND profissionais.ativo = true
  )
);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 5. COMENTÁRIOS
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

COMMENT ON TABLE public.areas IS 'Áreas/setores da organização';
COMMENT ON COLUMN public.areas.id IS 'Identificador único da área';
COMMENT ON COLUMN public.areas.nome IS 'Nome da área (ex: Marketing, TI, RH)';
COMMENT ON COLUMN public.areas.ativo IS 'Se a área está ativa';
COMMENT ON COLUMN public.areas.created_at IS 'Data de criação da área';

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 6. VALIDAÇÃO
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Verificar se a tabela foi criada
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public'
    AND table_name = 'areas'
  ) THEN
    RAISE NOTICE 'Tabela public.areas criada com sucesso!';
  ELSE
    RAISE EXCEPTION 'Erro: Tabela public.areas não foi criada!';
  END IF;
END $$;
