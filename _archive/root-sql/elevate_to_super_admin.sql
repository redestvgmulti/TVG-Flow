-- =====================================================
-- SQL: Elevar usuário a Super Admin
-- =====================================================
-- Execute este SQL no Supabase SQL Editor
-- após criar o usuário via Dashboard

-- Criar profissional super admin vinculado ao auth.users
INSERT INTO public.profissionais (id, email, nome, role, ativo, created_at)
SELECT 
    u.id,
    u.email,
    'Geovane Panini',
    'super_admin',
    true,
    now()
FROM auth.users u
WHERE u.email = 'geovanepanini@icloud.com'
ON CONFLICT (id) DO UPDATE
SET 
    email = EXCLUDED.email,
    nome = EXCLUDED.nome,
    role = 'super_admin',
    ativo = true;

-- Verificar se funcionou
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
