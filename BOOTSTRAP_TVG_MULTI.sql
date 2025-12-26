-- BOOTSTRAP: Garantir que TVG Multi existe e todos os profissionais estão vinculados

-- 1. Criar empresa TVG Multi se não existir
INSERT INTO empresas (id, nome, cnpj, status_conta, tipo_negocio, created_at, updated_at)
VALUES (
    '00000000-0000-0000-0000-000000000001',
    'TVG Multi',
    '00.000.000/0001-00',
    'active',
    'agency',
    NOW(),
    NOW()
)
ON CONFLICT (id) DO UPDATE SET
    nome = 'TVG Multi',
    status_conta = 'active',
    updated_at = NOW();

-- 2. Vincular TODOS os profissionais existentes à TVG Multi
-- IMPORTANTE: funcao não pode ser NULL, usar 'membro' como padrão
INSERT INTO empresa_profissionais (empresa_id, profissional_id, funcao, created_at)
SELECT 
    '00000000-0000-0000-0000-000000000001',
    p.id,
    COALESCE(
        CASE 
            WHEN p.role = 'admin' THEN 'gestor'
            WHEN p.role = 'super_admin' THEN 'gestor'
            ELSE 'membro'
        END,
        'membro'
    ) as funcao,
    NOW()
FROM profissionais p
WHERE NOT EXISTS (
    SELECT 1 FROM empresa_profissionais ep 
    WHERE ep.profissional_id = p.id 
    AND ep.empresa_id = '00000000-0000-0000-0000-000000000001'
);

-- 3. Verificar resultado
SELECT 
    e.nome as empresa,
    COUNT(ep.profissional_id) as total_profissionais,
    COUNT(CASE WHEN p.role = 'admin' THEN 1 END) as admins,
    COUNT(CASE WHEN p.role = 'professional' THEN 1 END) as professionals,
    COUNT(CASE WHEN p.role = 'super_admin' THEN 1 END) as super_admins
FROM empresas e
LEFT JOIN empresa_profissionais ep ON ep.empresa_id = e.id
LEFT JOIN profissionais p ON p.id = ep.profissional_id
WHERE e.id = '00000000-0000-0000-0000-000000000001'
GROUP BY e.id, e.nome;
