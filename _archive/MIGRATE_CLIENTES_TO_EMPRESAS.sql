-- =====================================================
-- FlowOS V1 - Migração Definitiva: clientes → empresas
-- =====================================================
-- OBJETIVO: Unificar fonte de dados de empresas
-- ESTRATÉGIA: Migrar dados + atualizar FKs + deprecar clientes
-- =====================================================

-- PASSO 1: Análise de Dados
-- Verificar empresas em clientes que não existem em empresas
SELECT 
    c.id as cliente_id,
    c.nome as cliente_nome,
    c.cnpj,
    c.ativo,
    c.drive_link,
    e.id as empresa_id,
    e.nome as empresa_nome
FROM clientes c
LEFT JOIN empresas e ON LOWER(TRIM(c.nome)) = LOWER(TRIM(e.nome))
ORDER BY c.nome;

-- Contar registros
SELECT 
    'clientes' as tabela, 
    COUNT(*) as total 
FROM clientes
UNION ALL
SELECT 
    'empresas' as tabela, 
    COUNT(*) as total 
FROM empresas;

-- PASSO 2: Verificar Foreign Keys
-- Identificar tarefas que referenciam clientes
SELECT 
    COUNT(*) as total_tarefas_com_cliente_id
FROM tarefas 
WHERE cliente_id IS NOT NULL;

SELECT 
    COUNT(*) as total_tarefas_com_empresa_id
FROM tarefas 
WHERE empresa_id IS NOT NULL;

-- PASSO 3: Migração de Dados
-- Inserir empresas de clientes que não existem em empresas
-- (apenas se não houver duplicação por nome)
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
    WHERE LOWER(TRIM(e.nome)) = LOWER(TRIM(c.nome))
)
ON CONFLICT (id) DO NOTHING;

-- PASSO 4: Atualizar Foreign Keys em tarefas
-- Mapear cliente_id → empresa_id baseado no nome
UPDATE tarefas t
SET empresa_id = e.id
FROM clientes c
JOIN empresas e ON LOWER(TRIM(c.nome)) = LOWER(TRIM(e.nome))
WHERE t.cliente_id = c.id
  AND t.empresa_id IS NULL;

-- PASSO 5: Verificação Pós-Migração
-- Verificar se todas as tarefas têm empresa_id
SELECT 
    COUNT(*) as tarefas_sem_empresa
FROM tarefas 
WHERE empresa_id IS NULL;

-- Verificar se há tarefas órfãs (cliente_id sem empresa correspondente)
SELECT 
    t.id as tarefa_id,
    t.titulo,
    t.cliente_id,
    c.nome as cliente_nome
FROM tarefas t
LEFT JOIN clientes c ON t.cliente_id = c.id
LEFT JOIN empresas e ON t.empresa_id = e.id
WHERE t.cliente_id IS NOT NULL 
  AND e.id IS NULL;

-- PASSO 6: Relatório Final
SELECT 
    'Empresas em clientes' as metrica,
    COUNT(*) as valor
FROM clientes
UNION ALL
SELECT 
    'Empresas em empresas',
    COUNT(*)
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
