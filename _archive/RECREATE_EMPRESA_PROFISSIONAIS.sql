-- ========================================
-- FIX DEFINITIVO: Recriar empresa_profissionais com FK correta
-- ========================================

-- PASSO 1: Backup dos dados existentes
CREATE TEMP TABLE empresa_profissionais_backup AS
SELECT * FROM empresa_profissionais;

-- PASSO 2: Dropar a tabela problemática
DROP TABLE IF EXISTS empresa_profissionais CASCADE;

-- PASSO 3: Recriar a tabela com a estrutura correta
CREATE TABLE empresa_profissionais (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    profissional_id UUID NOT NULL REFERENCES profissionais(id) ON DELETE CASCADE,
    funcao TEXT NOT NULL DEFAULT 'membro',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(empresa_id, profissional_id)
);

-- PASSO 4: Habilitar RLS
ALTER TABLE empresa_profissionais ENABLE ROW LEVEL SECURITY;

-- PASSO 5: Criar políticas RLS básicas
CREATE POLICY "Users can view their own company relationships"
ON empresa_profissionais FOR SELECT
TO authenticated
USING (
    profissional_id = auth.uid()
    OR EXISTS (
        SELECT 1 FROM profissionais
        WHERE profissionais.id = auth.uid()
        AND profissionais.role IN ('admin', 'super_admin')
    )
);

-- PASSO 6: Restaurar dados (se houver)
INSERT INTO empresa_profissionais (empresa_id, profissional_id, funcao, created_at)
SELECT empresa_id, profissional_id, COALESCE(funcao, 'membro'), created_at
FROM empresa_profissionais_backup
ON CONFLICT (empresa_id, profissional_id) DO NOTHING;

-- PASSO 7: Verificar a nova estrutura
SELECT 
    conname AS constraint_name,
    confrelid::regclass AS referenced_table
FROM pg_constraint
WHERE conrelid = 'empresa_profissionais'::regclass
AND contype = 'f';
