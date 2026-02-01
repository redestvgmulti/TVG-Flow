-- =====================================================
-- MIGRAÇÃO: Super Admin Email Correto
-- =====================================================
-- De: geovanepanini@agencyflow.com (dummy)
-- Para: geovanepanini@icloud.com (real)
-- Data: 2026-01-13
-- =====================================================

-- 🔐 EXTENSÕES NECESSÁRIAS
-- Necessário para crypt() e gen_salt()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =====================================================
-- PASSO 1: Remover usuário antigo do auth.users (se existir)
-- =====================================================
DELETE FROM auth.users 
WHERE email = 'geovanepanini@agencyflow.com';

-- =====================================================
-- PASSO 2: Criar usuário correto no auth.users (se não existir)
-- =====================================================
INSERT INTO auth.users (
    id,
    email,
    email_confirmed_at,
    encrypted_password,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at,
    instance_id,
    aud,
    role
)
SELECT 
    gen_random_uuid(),
    'geovanepanini@icloud.com',
    now(),
    crypt('G1eovane23*', gen_salt('bf')),
    '{"provider": "email", "providers": ["email"]}'::jsonb,
    '{"full_name": "Geovane Panini"}'::jsonb,
    now(),
    now(),
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated'
WHERE NOT EXISTS (
    SELECT 1 
    FROM auth.users 
    WHERE email = 'geovanepanini@icloud.com'
);

-- =====================================================
-- PASSO 3: Sincronizar com tabela profissionais
-- =====================================================
DO $$
DECLARE
    new_user_id UUID;
BEGIN
    -- Buscar ID do usuário no auth
    SELECT id 
    INTO new_user_id
    FROM auth.users
    WHERE email = 'geovanepanini@icloud.com';

    IF new_user_id IS NULL THEN
        RAISE EXCEPTION 'Usuário geovanepanini@icloud.com não encontrado em auth.users';
    END IF;

    -- Criar ou atualizar profissional como SUPER ADMIN
    INSERT INTO public.profissionais (
        id,
        email,
        nome,
        role,
        ativo,
        created_at
    )
    VALUES (
        new_user_id,
        'geovanepanini@icloud.com',
        'Geovane Panini',
        'super_admin',
        true,
        now()
    )
    ON CONFLICT (id) DO UPDATE
    SET 
        email = EXCLUDED.email,
        nome  = EXCLUDED.nome,
        role  = 'super_admin',
        ativo = true;

    -- Remover profissional antigo (dummy), se existir
    DELETE FROM public.profissionais
    WHERE email = 'geovanepanini@agencyflow.com'
      AND id <> new_user_id;

    RAISE NOTICE '✅ Super admin migrado com sucesso. ID: %', new_user_id;
END $$;

-- =====================================================
-- PASSO 4: Verificação final
-- =====================================================
SELECT 
    u.id,
    u.email,
    u.email_confirmed_at,
    p.nome,
    p.role,
    p.ativo
FROM auth.users u
LEFT JOIN public.profissionais p ON p.id = u.id
WHERE u.email = 'geovanepanini@icloud.com';