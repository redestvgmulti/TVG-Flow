-- Migration: Fix 'tarefas' foreign key to point to 'areas' instead of 'departamentos'

-- 1. Optional: Clean up orphaned department references that don't satisfy the new constraint.
-- This sets departamento_id to NULL if the id doesn't exist in the 'areas' table.
UPDATE public.tarefas
SET departamento_id = NULL
WHERE departamento_id IS NOT NULL 
  AND departamento_id NOT IN (SELECT id FROM public.areas);

-- 2. Drop the incorrect constraint
ALTER TABLE public.tarefas
DROP CONSTRAINT IF EXISTS tarefas_departamento_id_fkey;

-- 3. Add the correct constraint referencing 'areas'
ALTER TABLE public.tarefas
ADD CONSTRAINT tarefas_departamento_id_fkey
FOREIGN KEY (departamento_id)
REFERENCES public.areas(id)
ON DELETE SET NULL;
