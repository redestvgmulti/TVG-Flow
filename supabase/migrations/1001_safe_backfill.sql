-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- Migration: Backfill CONSERVADOR de empresa_id
-- Data: 2026-01-07
-- Descrição: Preencher APENAS empresa_id onde houver evidência confiável
-- AJUSTE OBRIGATÓRIO: NÃO presumir assigned_to = created_by
-- Apenas preencher empresa_id para dados legados
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

BEGIN;

-- Backfill empresa_id: pegar primeira empresa do assigned_to
-- Estratégia conservadora: apenas onde assigned_to existe
UPDATE tarefas t
SET empresa_id = (
    SELECT ep.empresa_id
    FROM empresa_profissionais ep
    WHERE ep.profissional_id = t.assigned_to
    AND ep.ativo = true
    ORDER BY ep.created_at ASC  -- Pega a mais antiga (presumivelmente a principal)
    LIMIT 1
)
WHERE t.empresa_id IS NULL
AND t.assigned_to IS NOT NULL;

-- Log
DO $$
DECLARE
    updated_count INTEGER;
    still_null INTEGER;
BEGIN
    SELECT COUNT(*) INTO updated_count FROM tarefas WHERE empresa_id IS NOT NULL;
    SELECT COUNT(*) INTO still_null FROM tarefas WHERE empresa_id IS NULL;
    
    RAISE NOTICE 'Backfill completed.';
    RAISE NOTICE 'Tarefas with empresa_id: %', updated_count;
    RAISE NOTICE 'Tarefas still NULL (acceptable for legacy): %', still_null;
END $$;

-- ❌ NÃO fazer backfill de created_by (decisão aprovada)
-- Dados legados permanecem com created_by = NULL
-- Apenas tarefas NOVAS terão created_by preenchido

COMMIT;
