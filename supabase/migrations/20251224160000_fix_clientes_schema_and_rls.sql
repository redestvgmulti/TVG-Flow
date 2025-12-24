-- FIX CLIENTES SCHEMA AND RLS
-- Description:
-- 1. Companies.jsx uses 'clientes' table but expects 'ativo' and 'cnpj' columns which were missing in 001_initial_schema.
-- 2. RLS policy for 'clientes' needs to be re-asserted to ensure Admins can manage them.

-- 1. Schema Updates
ALTER TABLE public.clientes ADD COLUMN IF NOT EXISTS ativo BOOLEAN DEFAULT true;
ALTER TABLE public.clientes ADD COLUMN IF NOT EXISTS cnpj TEXT;

-- 2. RLS Fixes
ALTER TABLE public.clientes ENABLE ROW LEVEL SECURITY;

-- Drop potentially conflicting or broken policies
DROP POLICY IF EXISTS "Admin tem acesso total a clientes" ON public.clientes;
DROP POLICY IF EXISTS "Profissional pode visualizar clientes" ON public.clientes;

-- Re-create Admin Policy (Full Access)
CREATE POLICY "Admin tem acesso total a clientes"
    ON public.clientes
    FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.profissionais
            WHERE id = auth.uid()
            AND role = 'admin'
        )
    );

-- Re-create Professional Policy (Read Only)
CREATE POLICY "Profissional pode visualizar clientes"
    ON public.clientes
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.profissionais
            WHERE id = auth.uid()
            AND ativo = true
        )
    );

-- Comment
COMMENT ON TABLE public.clientes IS 'Tabela principal de Empresas/Clientes';
