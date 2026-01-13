-- Script de debug: verificar estado do super admin
-- Execute este SQL no Supabase SQL Editor

-- 1. Verificar usuário no auth.users
SELECT 
    id,
    email,
    email_confirmed_at,
    created_at,
    raw_user_meta_data
FROM auth.users
WHERE email = 'geovanepanini@icloud.com';

-- 2. Verificar profissional na tabela pública
SELECT *
FROM public.profissionais
WHERE email = 'geovanepanini@icloud.com';

-- 3. Se o problema for que o profissional não existe, executar isto:
-- INSERT INTO public.profissionais (id, email, nome, role, ativo, created_at)
-- SELECT 
--     u.id,
--     u.email,
--     'Geovane Panini',
--     'super_admin',
--     true,
--     now()
-- FROM auth.users u
-- WHERE u.email = 'geovanepanini@icloud.com'
-- AND NOT EXISTS (
--     SELECT 1 FROM public.profissionais p WHERE p.email = u.email
-- );

-- 4. Verificar se há triggers quebrando o login
SELECT 
    tgname as trigger_name,
    tgrelid::regclass as table_name,
    tgenabled as enabled
FROM pg_trigger
WHERE tgrelid IN (
    'auth.users'::regclass,
    'public.profissionais'::regclass
)
AND tgname NOT LIKE 'pg_%'
AND tgname NOT LIKE 'RI_%';
