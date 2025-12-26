-- Verificar o role do usuário Super Admin
SELECT id, nome, email, role, ativo 
FROM profissionais 
WHERE email = 'geovanepanini@agencyflow.com';

-- Se o role não for 'super_admin', corrigir:
UPDATE profissionais 
SET role = 'super_admin' 
WHERE email = 'geovanepanini@agencyflow.com';

-- Testar a função RPC
SELECT * FROM get_companies_stats();

-- Verificar se existem empresas
SELECT id, nome, status_conta, created_at FROM empresas LIMIT 5;
