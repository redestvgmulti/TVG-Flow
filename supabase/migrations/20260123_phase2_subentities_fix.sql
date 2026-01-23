-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- MIGRATION: FASE 2 - SUB-ENTIDADES (CLIENTES) - ADJUSTED
-- DATE: 2026-01-23
-- DESCRIPTION: Corrige o modelo de domínio de 'clientes'.
-- 1. Cria coluna empresa_id (Tenant).
-- 2. Realiza Backfill inteligente (apenas inferência segura).
-- 3. Aplica RLS estrito (Isolamento de Tenant).
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- 1. Schema Evolution
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS empresa_id UUID REFERENCES empresas(id);

-- 2. Backfill Strategy (Inferência Segura Apenas)
DO $$
BEGIN
    -- Estratégia A: Inferir via Tarefas (Se o cliente tem tarefa, pertence à empresa da tarefa)
    -- Atualiza apenas se tiver certeza baseada em dados históricos.
    UPDATE clientes c
    SET empresa_id = (
        SELECT t.empresa_id 
        FROM tarefas t 
        WHERE t.cliente_id = c.id 
        ORDER BY t.created_at DESC 
        LIMIT 1
    )
    WHERE empresa_id IS NULL;

    -- REMOVIDO: Estratégia B (Fallback)
    -- Clientes sem tarefas permanecerão com empresa_id NULL (Orphans).
    -- Eles serão visíveis apenas para Super Admin até correção manual.

    -- REMOVIDO: Constraint NOT NULL
    -- ALTER TABLE clientes ALTER COLUMN empresa_id SET NOT NULL;
    
    RAISE NOTICE 'Backfill de inferência concluído. Clientes órfãos permaneceram NULL.';
END $$;

-- 3. RLS Policies
ALTER TABLE clientes ENABLE ROW LEVEL SECURITY;

-- Drop antigas para limpar
DROP POLICY IF EXISTS "Admin tem acesso total a clientes" ON clientes;
DROP POLICY IF EXISTS "Profissional pode visualizar clientes" ON clientes;
DROP POLICY IF EXISTS "Super Admin global access" ON clientes;

-- Policy 1: Super Admin (Global Update/Delete/Select/Insert)
CREATE POLICY "Super Admin: Full Access"
ON clientes
FOR ALL
TO authenticated
USING (public.is_super_admin())
WITH CHECK (public.is_super_admin());

-- Policy 2: Admin (Tenant Bound - Select/Insert/Update)
-- Admin pode gerenciar clientes DO SEU TENANT.
-- Clientes com empresa_id NULL não serão vistos por nenhum Admin.
CREATE POLICY "Admin: Tenant Management"
ON clientes
FOR ALL
TO authenticated
USING (
    public.is_admin_safe() AND
    empresa_id IN (
        SELECT empresa_id 
        FROM empresa_profissionais 
        WHERE profissional_id = auth.uid() 
        AND ativo = true
    )
)
WITH CHECK (
    public.is_admin_safe() AND
    empresa_id IN (
        SELECT empresa_id 
        FROM empresa_profissionais 
        WHERE profissional_id = auth.uid() 
        AND ativo = true
    )
);

-- Policy 3: Staff (No Access - conforme pedido)

-- 4. Performance Index
CREATE INDEX IF NOT EXISTS idx_clientes_empresa_id ON clientes(empresa_id);
