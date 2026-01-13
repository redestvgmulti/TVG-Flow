-- =====================================================
-- SOLUÇÃO FINAL: Criar Super Admin via Admin API
-- =====================================================
-- Método 1: Via Supabase Dashboard (RECOMENDADO)
-- =====================================================
-- 1. Acesse: https://supabase.com/dashboard/project/gyooxmpyxncrezjiljrj/auth/users
-- 2. Clique em "Add user" → "Create new user"
-- 3. Email: geovanepanini@icloud.com
-- 4. Password: G1eovane23*
-- 5. Auto Confirm User: YES (marcar)
-- 6. Copie o User ID gerado
-- 7. Execute o SQL abaixo substituindo USER_ID_AQUI pelo ID copiado

-- =====================================================
-- Método 2: Via SQL (execute DEPOIS de criar no dashboard)
-- =====================================================

-- IMPORTANTE: Substitua 'USER_ID_AQUI' pelo ID do usuário criado no dashboard
DO $$
DECLARE
    auth_user_id UUID := 'USER_ID_AQUI'; -- COLE O ID DO USUÁRIO AQUI
    existing_prof_id UUID := '02773a93-ea15-47b0-bbef-517b2d3faa00';
BEGIN
    -- 1. Atualizar o profissional existente com o novo user ID do auth
    UPDATE public.profissionais
    SET id = auth_user_id
    WHERE id = existing_prof_id;
    
    -- 2. Confirmar o email no auth.users
    UPDATE auth.users
    SET email_confirmed_at = now(),
        raw_app_meta_data = '{"provider":"email","providers":["email"]}'::jsonb
    WHERE id = auth_user_id;
    
    RAISE NOTICE 'Super admin configurado com sucesso!';
END $$;

-- Verificar
SELECT 
    u.id,
    u.email,
    u.email_confirmed_at,
    p.nome,
    p.role
FROM auth.users u
JOIN public.profissionais p ON p.id = u.id
WHERE u.email = 'geovanepanini@icloud.com';
