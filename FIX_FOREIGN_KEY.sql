-- CORREÇÃO CRÍTICA: Foreign Key apontando para tabela errada
-- A FK empresa_profissionais_empresa_id_fkey está apontando para 'clientes' em vez de 'empresas'

-- 1. Remover a FK incorreta
ALTER TABLE empresa_profissionais 
DROP CONSTRAINT IF EXISTS empresa_profissionais_empresa_id_fkey;

-- 2. Criar a FK correta apontando para 'empresas'
ALTER TABLE empresa_profissionais
ADD CONSTRAINT empresa_profissionais_empresa_id_fkey 
FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE;

-- 3. Verificar a correção
SELECT 
    conname AS constraint_name,
    conrelid::regclass AS table_name,
    confrelid::regclass AS referenced_table
FROM pg_constraint
WHERE conname = 'empresa_profissionais_empresa_id_fkey';
