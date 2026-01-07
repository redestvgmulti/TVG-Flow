-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- Migration 1017: Adicionar eventos de governança ao enum
-- Data: 2026-01-07
-- Descrição: Adicionar novos tipos de evento para ETAPA 4 (Governança)
--            Eventos estruturais e de auditoria
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

BEGIN;

-- Adicionar novos valores ao enum os_evento_tipo
-- NOTA: Postgres não permite ADD IF NOT EXISTS em enum antes de v12
-- Usamos DO block para evitar erro se já existir

DO $$
BEGIN
    -- Eventos de governança
    ALTER TYPE os_evento_tipo ADD VALUE IF NOT EXISTS 'os_convertida_complexa';
    ALTER TYPE os_evento_tipo ADD VALUE IF NOT EXISTS 'etapa_adicionada';
    ALTER TYPE os_evento_tipo ADD VALUE IF NOT EXISTS 'etapa_removida';
    ALTER TYPE os_evento_tipo ADD VALUE IF NOT EXISTS 'prazo_alterado';
    ALTER TYPE os_evento_tipo ADD VALUE IF NOT EXISTS 'responsavel_reatribuido';
    ALTER TYPE os_evento_tipo ADD VALUE IF NOT EXISTS 'titulo_alterado';
    ALTER TYPE os_evento_tipo ADD VALUE IF NOT EXISTS 'os_excluida';
EXCEPTION WHEN duplicate_object THEN
    RAISE NOTICE 'Valores de enum já existem, ignorando';
END $$;

-- Comentários
COMMENT ON TYPE os_evento_tipo IS 'ETAPA 3+4: Tipos de eventos da OS. Core (ETAPA 3): os_criada, comentario_adicionado, status_alterado. Governança (ETAPA 4): os_convertida_complexa, etapa_adicionada/removida, prazo_alterado, responsavel_reatribuido, titulo_alterado, os_excluida';

-- Log
DO $$
BEGIN
    RAISE NOTICE '✅ Migration 1017: Enum os_evento_tipo atualizado com eventos de governança (ETAPA 4)';
END $$;

COMMIT;
