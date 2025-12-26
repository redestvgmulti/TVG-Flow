-- ========================================
-- FIX FINAL: Verificar triggers e forçar FK correta
-- ========================================

-- PASSO 1: Verificar se há triggers que podem estar recriando a FK
SELECT 
    trigger_name,
    event_manipulation,
    event_object_table,
    action_statement
FROM information_schema.triggers
WHERE event_object_table = 'empresa_profissionais';

-- PASSO 2: Verificar TODAS as constraints (não só FK)
SELECT 
    conname AS constraint_name,
    contype AS constraint_type,
    confrelid::regclass AS referenced_table,
    pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'empresa_profissionais'::regclass;

-- PASSO 3: Dropar TODAS as constraints de FK manualmente (uma por uma)
ALTER TABLE empresa_profissionais DROP CONSTRAINT IF EXISTS empresa_profissionais_empresa_id_fkey CASCADE;
ALTER TABLE empresa_profissionais DROP CONSTRAINT IF EXISTS empresa_profissionais_empresa_fkey CASCADE;
ALTER TABLE empresa_profissionais DROP CONSTRAINT IF EXISTS fk_empresa CASCADE;
ALTER TABLE empresa_profissionais DROP CONSTRAINT IF EXISTS fk_empresa_id CASCADE;

-- PASSO 4: Verificar se ainda há alguma FK
SELECT 
    conname AS remaining_fk
FROM pg_constraint
WHERE conrelid = 'empresa_profissionais'::regclass
AND contype = 'f';

-- PASSO 5: Adicionar a FK correta com nome único
ALTER TABLE empresa_profissionais
ADD CONSTRAINT fk_empresa_profissionais_to_empresas
FOREIGN KEY (empresa_id) 
REFERENCES empresas(id) 
ON DELETE CASCADE;

-- PASSO 6: Verificar a FK final
SELECT 
    conname AS constraint_name,
    confrelid::regclass AS referenced_table,
    pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'empresa_profissionais'::regclass
AND contype = 'f';
