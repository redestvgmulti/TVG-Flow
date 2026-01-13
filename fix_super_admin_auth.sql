-- =====================================================
-- CORREÇÃO: Criar super admin via Supabase Auth Admin
-- =====================================================
-- Execute este SQL no Supabase SQL Editor

-- PASSO 1: Verificar se usuário existe em auth.users
SELECT id, email, email_confirmed_at, encrypted_password 
FROM auth.users 
WHERE email = 'geovanepanini@icloud.com';

-- Se NÃO retornou nada, o usuário não existe no auth
-- Se retornou mas encrypted_password está NULL ou vazio, a senha não foi configurada

-- PASSO 2: Deletar e recriar o usuário corretamente
DELETE FROM auth.users WHERE email = 'geovanepanini@icloud.com';

-- PASSO 3: Criar usuário usando a API interna do Supabase
-- (Este método garante que a senha seja criptografada corretamente)
DO $$
DECLARE
    new_user_id UUID;
BEGIN
    -- Criar usuário no auth.users via função segura
    INSERT INTO auth.users (
        instance_id,
        id,
        aud,
        role,
        email,
        encrypted_password,
        email_confirmed_at,
        recovery_sent_at,
        last_sign_in_at,
        raw_app_meta_data,
        raw_user_meta_data,
        created_at,
        updated_at,
        confirmation_token,
        email_change,
        email_change_token_new,
        recovery_token
    ) VALUES (
        '00000000-0000-0000-0000-000000000000',
        '02773a93-ea15-47b0-bbef-517b2d3faa00', -- Mesmo ID do profissional
        'authenticated',
        'authenticated',
        'geovanepanini@icloud.com',
        crypt('G1eovane23*', gen_salt('bf')),
        now(),
        null,
        null,
        '{"provider":"email","providers":["email"]}'::jsonb,
        '{}'::jsonb,
        now(),
        now(),
        '',
        '',
        '',
        ''
    )
    ON CONFLICT (id) DO UPDATE
    SET 
        email = 'geovanepanini@icloud.com',
        encrypted_password = crypt('G1eovane23*', gen_salt('bf')),
        email_confirmed_at = now(),
        updated_at = now();
    
    RAISE NOTICE 'Usuário criado/atualizado com sucesso!';
END $$;

-- PASSO 4: Verificar criação
SELECT 
    u.id,
    u.email,
    u.email_confirmed_at,
    u.encrypted_password IS NOT NULL as has_password,
    p.nome,
    p.role
FROM auth.users u
LEFT JOIN public.profissionais p ON p.id = u.id
WHERE u.email = 'geovanepanini@icloud.com';
