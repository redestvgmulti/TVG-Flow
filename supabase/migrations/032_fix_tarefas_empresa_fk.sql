-- =====================================================
-- Fix Foreign Key: tarefas.empresa_id → empresas
-- =====================================================
-- Problem: tarefas.empresa_id references clientes(id)
-- Solution: Update FK to reference empresas(id)
-- =====================================================

-- Step 1: Drop the old foreign key constraint
DO $$
BEGIN
    -- Check if the constraint exists and drop it
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'tarefas_empresa_id_fkey' 
        AND table_name = 'tarefas'
    ) THEN
        ALTER TABLE public.tarefas 
        DROP CONSTRAINT tarefas_empresa_id_fkey;
        
        RAISE NOTICE 'Dropped old FK constraint: tarefas_empresa_id_fkey';
    END IF;
    
    -- Also check for the old clientes FK if it exists with different name
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

-- Verification query (run this to verify the change)
-- SELECT 
--     tc.constraint_name,
--     tc.table_name,
--     kcu.column_name,
--     ccu.table_name AS foreign_table_name,
--     ccu.column_name AS foreign_column_name
-- FROM information_schema.table_constraints AS tc
-- JOIN information_schema.key_column_usage AS kcu
--     ON tc.constraint_name = kcu.constraint_name
-- JOIN information_schema.constraint_column_usage AS ccu
--     ON ccu.constraint_name = tc.constraint_name
-- WHERE tc.table_name = 'tarefas' 
-- AND tc.constraint_type = 'FOREIGN KEY'
-- AND kcu.column_name = 'empresa_id';
