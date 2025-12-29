-- =====================================================
-- FlowOS V1 - Migração Definitiva: clientes → empresas
-- EXECUÇÃO SIMPLIFICADA
-- =====================================================

-- PASSO 1: Análise Pré-Migração
-- Verificar quantas empresas existem em cada tabela
SELECT 
    'clientes' as tabela, 
    COUNT(*) as total 
FROM clientes
UNION ALL
SELECT 
    'empresas (operacional)' as tabela, 
    COUNT(*) as total 
FROM empresas
WHERE empresa_tipo = 'operacional';

-- PASSO 2: Verificar tarefas que usam cliente_id vs empresa_id
SELECT 
    'Tarefas com cliente_id' as tipo,
    COUNT(*) as total
FROM tarefas 
WHERE cliente_id IS NOT NULL
UNION ALL
SELECT 
    'Tarefas com empresa_id' as tipo,
    COUNT(*) as total
FROM tarefas 
WHERE empresa_id IS NOT NULL;

-- PASSO 3: Migrar dados de clientes para empresas (se não existirem)
-- Apenas inserir se não houver conflito de nome
INSERT INTO empresas (id, nome, cnpj, ativo, drive_link, empresa_tipo, created_at)
SELECT 
    c.id,
    c.nome,
    c.cnpj,
    COALESCE(c.ativo, true),
    c.drive_link,
    'operacional' as empresa_tipo,
    COALESCE(c.created_at, NOW())
FROM clientes c
WHERE NOT EXISTS (
    SELECT 1 
    FROM empresas e 
    WHERE e.id = c.id
)
ON CONFLICT (id) DO NOTHING;

-- PASSO 4: Atualizar tarefas para usar empresa_id
-- Copiar cliente_id para empresa_id onde empresa_id está NULL
UPDATE tarefas
SET empresa_id = cliente_id
WHERE cliente_id IS NOT NULL 
  AND empresa_id IS NULL;

-- PASSO 5: Verificação Final
SELECT 
    'Empresas totais' as metrica,
    COUNT(*) as valor
FROM empresas
WHERE empresa_tipo = 'operacional'
UNION ALL
SELECT 
    'Tarefas com empresa_id',
    COUNT(*)
FROM tarefas
WHERE empresa_id IS NOT NULL
UNION ALL
SELECT 
    'Tarefas sem empresa_id',
    COUNT(*)
FROM tarefas
WHERE empresa_id IS NULL;
