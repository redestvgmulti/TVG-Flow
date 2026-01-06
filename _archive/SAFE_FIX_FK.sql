-- ========================================
-- FIX SEGURO: Apenas alterar a FK sem dropar a tabela
-- ========================================

-- PASSO 1: Listar todas as constraints de FK
SELECT 
    conname AS constraint_name,
    confrelid::regclass AS referenced_table
FROM pg_constraint
WHERE conrelid = 'empresa_profissionais'::regclass
AND contype = 'f';

-- PASSO 2: Dropar TODAS as FKs relacionadas a empresa_id
DO $$
DECLARE
    constraint_rec RECORD;
BEGIN
    FOR constraint_rec IN 
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'empresa_profissionais'::regclass
        AND contype = 'f'
        AND conname LIKE '%empresa_id%'
    LOOP
        EXECUTE format('ALTER TABLE empresa_profissionais DROP CONSTRAINT IF EXISTS %I', constraint_rec.conname);
    END LOOP;
END $$;

-- PASSO 3: Criar a FK correta
ALTER TABLE empresa_profissionais
ADD CONSTRAINT empresa_profissionais_empresa_id_fkey 
FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE;

-- PASSO 4: Verificar o resultado
SELECT 
    conname AS constraint_name,
    confrelid::regclass AS referenced_table,
    pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'empresa_profissionais'::regclass
AND contype = 'f';
