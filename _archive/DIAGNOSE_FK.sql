-- DIAGNÓSTICO: Verificar TODAS as constraints da tabela empresa_profissionais

-- 1. Listar todas as FKs da tabela
SELECT 
    conname AS constraint_name,
    conrelid::regclass AS table_name,
    confrelid::regclass AS referenced_table,
    pg_get_constraintdef(oid) AS constraint_definition
FROM pg_constraint
WHERE conrelid = 'empresa_profissionais'::regclass
AND contype = 'f';

-- 2. Verificar estrutura da tabela
SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_name = 'empresa_profissionais'
ORDER BY ordinal_position;

-- 3. Verificar se a tabela 'clientes' existe
SELECT EXISTS (
    SELECT 1 
    FROM information_schema.tables 
    WHERE table_name = 'clientes'
) as clientes_table_exists;

-- 4. Verificar se a tabela 'empresas' existe
SELECT EXISTS (
    SELECT 1 
    FROM information_schema.tables 
    WHERE table_name = 'empresas'
) as empresas_table_exists;
