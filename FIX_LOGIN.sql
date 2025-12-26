-- SOLUÇÃO DEFINITIVA PARA O ERRO "Email not confirmed" e "Invalid login"

-- 1. Confirmar o e-mail na tabela de autenticação (auth.users)
-- Isso evita o erro "Email not confirmed"
UPDATE auth.users
SET email_confirmed_at = now(),
    confirmed_at = now(),
    last_sign_in_at = now(),
    raw_app_meta_data = '{"provider": "email", "providers": ["email"]}'
WHERE email = 'geovanepanini@agencyflow.com';

-- 2. Garantir que o usuário exista na tabela pública (public.profissionais)
-- Isso evita o erro de "Violates Row Level Security" ou usuário inexistente
INSERT INTO public.profissionais (id, email, nome, role, ativo)
SELECT 
    id, 
    email, 
    'Geovane Panini (Super Admin)', 
    'super_admin', 
    true
FROM auth.users
WHERE email = 'geovanepanini@agencyflow.com'
ON CONFLICT (id) DO UPDATE
SET 
    role = 'super_admin', 
    ativo = true, 
    nome = EXCLUDED.nome;

-- Verificação:
SELECT * FROM public.profissionais WHERE email = 'geovanepanini@agencyflow.com';
