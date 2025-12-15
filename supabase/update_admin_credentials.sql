-- ============================================
-- ATUALIZAR CREDENCIAIS DO USUÁRIO ADMIN
-- ============================================
-- Este script atualiza o email e senha do usuário admin existente
-- Novas credenciais: evandro@tvgflow.com / tvgflow2025
-- Role: admin (mantido)
-- ============================================

-- PASSO 1: Verificar usuário atual
-- Execute este SELECT para ver o usuário atual
SELECT 
    id,
    email,
    created_at,
    email_confirmed_at
FROM auth.users
ORDER BY created_at DESC
LIMIT 5;

-- PASSO 2: Atualizar email no Supabase Auth
-- IMPORTANTE: Substitua 'USER_ID_AQUI' pelo ID do usuário que você quer atualizar
-- Você pode pegar o ID do SELECT acima

UPDATE auth.users
SET 
    email = 'evandro@tvgflow.com',
    raw_user_meta_data = jsonb_set(
        COALESCE(raw_user_meta_data, '{}'::jsonb),
        '{email}',
        '"evandro@tvgflow.com"'
    ),
    email_confirmed_at = NOW(),
    updated_at = NOW()
WHERE email = 'admin@tvgflow.com'  -- Email antigo
   OR id = 'USER_ID_AQUI';  -- OU use o ID específico

-- PASSO 3: Atualizar senha
-- IMPORTANTE: Substitua 'USER_ID_AQUI' pelo ID do usuário
-- A senha será: tvgflow2025

UPDATE auth.users
SET 
    encrypted_password = crypt('tvgflow2025', gen_salt('bf')),
    updated_at = NOW()
WHERE email = 'evandro@tvgflow.com';

-- PASSO 4: Atualizar tabela profissionais
-- Atualizar o email na tabela profissionais para manter sincronizado

UPDATE profissionais
SET 
    email = 'evandro@tvgflow.com',
    updated_at = NOW()
WHERE email = 'admin@tvgflow.com'
   OR role = 'admin';

-- PASSO 5: Verificar atualização
-- Confirme que tudo foi atualizado corretamente

SELECT 
    u.id,
    u.email,
    u.email_confirmed_at,
    p.nome,
    p.email as email_profissional,
    p.role,
    p.ativo
FROM auth.users u
LEFT JOIN profissionais p ON p.id = u.id
WHERE u.email = 'evandro@tvgflow.com';

-- ============================================
-- RESULTADO ESPERADO:
-- ============================================
-- Email: evandro@tvgflow.com
-- Senha: tvgflow2025
-- Role: admin
-- Ativo: true
-- Email confirmado: SIM
-- ============================================

-- ============================================
-- ALTERNATIVA: CRIAR NOVO USUÁRIO ADMIN
-- ============================================
-- Se preferir criar um novo usuário ao invés de atualizar:

/*
-- 1. Criar usuário no Supabase Auth
INSERT INTO auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at,
    confirmation_token,
    recovery_token
) VALUES (
    '00000000-0000-0000-0000-000000000000',
    gen_random_uuid(),
    'authenticated',
    'authenticated',
    'evandro@tvgflow.com',
    crypt('tvgflow2025', gen_salt('bf')),
    NOW(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    NOW(),
    NOW(),
    '',
    ''
);

-- 2. Pegar o ID do usuário criado
SELECT id, email FROM auth.users WHERE email = 'evandro@tvgflow.com';

-- 3. Criar perfil na tabela profissionais
-- IMPORTANTE: Substitua 'USER_ID_AQUI' pelo ID retornado acima

INSERT INTO profissionais (
    id,
    nome,
    email,
    role,
    ativo,
    created_at,
    updated_at
) VALUES (
    'USER_ID_AQUI',  -- ID do usuário do auth.users
    'Evandro - Admin',
    'evandro@tvgflow.com',
    'admin',
    true,
    NOW(),
    NOW()
);

-- 4. Verificar
SELECT 
    u.id,
    u.email,
    p.nome,
    p.role,
    p.ativo
FROM auth.users u
LEFT JOIN profissionais p ON p.id = u.id
WHERE u.email = 'evandro@tvgflow.com';
*/

-- ============================================
-- INSTRUÇÕES DE USO:
-- ============================================
-- 1. Acesse o Supabase Dashboard
-- 2. Vá em SQL Editor
-- 3. Execute os comandos na ordem (PASSO 1 a 5)
-- 4. Substitua 'USER_ID_AQUI' quando necessário
-- 5. Teste o login com as novas credenciais
-- ============================================
