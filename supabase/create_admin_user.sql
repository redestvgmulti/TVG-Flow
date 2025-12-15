-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- Script para criar usuário admin no TVG Flow
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- PASSO 1: Buscar o UUID do usuário criado no Auth
-- Copie o UUID que aparecer na coluna 'id'
SELECT id, email, created_at 
FROM auth.users 
WHERE email = 'evandro@tvgflow.com';

-- PASSO 2: Inserir o profissional como ADMIN GERAL
-- IMPORTANTE: Substitua 'COLE_UUID_DO_USUARIO_AQUI' pelo UUID do PASSO 1
-- Nota: departamento_id fica NULL pois é admin geral (não vinculado a departamento específico)

INSERT INTO profissionais (id, nome, email, departamento_id, role, ativo)
VALUES (
  'COLE_UUID_DO_USUARIO_AQUI',           -- UUID do auth.users
  'Evandro Admin',                        -- Nome do profissional
  'evandro@tvgflow.com',                  -- Email (mesmo do auth)
  NULL,                                   -- NULL = Admin geral (não vinculado a departamento)
  'admin',                                -- Role: admin
  true                                    -- Ativo: true
);

-- PASSO 3: Verificar se foi criado corretamente
SELECT 
  p.id,
  p.nome,
  p.email,
  p.role,
  p.ativo,
  p.departamento_id,
  CASE 
    WHEN p.departamento_id IS NULL THEN 'Admin Geral'
    ELSE d.nome 
  END as departamento
FROM profissionais p
LEFT JOIN departamentos d ON p.departamento_id = d.id
WHERE p.email = 'evandro@tvgflow.com';

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- INSTRUÇÕES:
-- 
-- 1. Acesse: https://supabase.com/dashboard/project/gyooxmpyxncrezjiljrj/sql/new
-- 2. Execute o PASSO 1 para pegar o UUID do usuário
-- 3. Cole o UUID no PASSO 2 e execute
-- 4. Execute o PASSO 3 para confirmar
-- 
-- O usuário será criado como ADMIN GERAL (sem departamento específico)
-- 
-- Depois disso, você poderá fazer login com:
-- Email: evandro@tvgflow.com
-- Senha: tvgflow2025
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
