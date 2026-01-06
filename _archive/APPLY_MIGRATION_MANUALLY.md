# Aplicar Migration Manualmente

## Problema
O comando `npx supabase db push` falhou devido a divergência entre migrations locais e remotas.

## Solução: Aplicar via Supabase Dashboard

### Passo 1: Acessar SQL Editor
1. Abra: https://supabase.com/dashboard/project/gyooxmpyxncrezjiljrj/sql
2. Clique em "New query"

### Passo 2: Copiar e Executar SQL

Copie TODO o conteúdo do arquivo `supabase/migrations/032_fix_tarefas_empresa_fk.sql` e cole no SQL Editor.

Ou copie diretamente daqui:

```sql
-- =====================================================
-- Fix Foreign Key: tarefas.empresa_id → empresas
-- =====================================================

-- Step 1: Drop the old foreign key constraint
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'tarefas_empresa_id_fkey' 
        AND table_name = 'tarefas'
    ) THEN
        ALTER TABLE public.tarefas 
        DROP CONSTRAINT tarefas_empresa_id_fkey;
        
        RAISE NOTICE 'Dropped old FK constraint: tarefas_empresa_id_fkey';
    END IF;
    
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name LIKE '%cliente%' 
        AND table_name = 'tarefas'
        AND constraint_type = 'FOREIGN KEY'
    ) THEN
        EXECUTE (
            SELECT 'ALTER TABLE public.tarefas DROP CONSTRAINT ' || constraint_name || ';'
            FROM information_schema.table_constraints
            WHERE constraint_name LIKE '%cliente%' 
            AND table_name = 'tarefas'
            AND constraint_type = 'FOREIGN KEY'
            LIMIT 1
        );
        
        RAISE NOTICE 'Dropped old clientes FK constraint';
    END IF;
END $$;

-- Step 2: Ensure empresa_id column exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'tarefas' 
        AND column_name = 'empresa_id'
    ) THEN
        ALTER TABLE public.tarefas 
        ADD COLUMN empresa_id UUID;
        
        RAISE NOTICE 'Added empresa_id column';
    END IF;
END $$;

-- Step 3: Create new foreign key constraint pointing to empresas
ALTER TABLE public.tarefas
ADD CONSTRAINT tarefas_empresa_id_fkey 
FOREIGN KEY (empresa_id) 
REFERENCES public.empresas(id) 
ON DELETE SET NULL;

-- Step 4: Create index for performance
CREATE INDEX IF NOT EXISTS idx_tarefas_empresa_id 
ON public.tarefas(empresa_id);
```

### Passo 3: Executar
Clique em "Run" ou pressione `Ctrl+Enter`

### Passo 4: Verificar
Após executar, verifique se a FK foi criada corretamente:

```sql
SELECT 
    tc.constraint_name,
    tc.table_name,
    kcu.column_name,
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
    ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage AS ccu
    ON ccu.constraint_name = tc.constraint_name
WHERE tc.table_name = 'tarefas' 
AND tc.constraint_type = 'FOREIGN KEY'
AND kcu.column_name = 'empresa_id';
```

**Resultado esperado**: Deve mostrar que `empresa_id` referencia `empresas(id)`

### Passo 5: Testar Criação de Tarefa
Após aplicar a migration, teste novamente criar uma tarefa com workflow.

## Link Direto
https://supabase.com/dashboard/project/gyooxmpyxncrezjiljrj/sql/new
