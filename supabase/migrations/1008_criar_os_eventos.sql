-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- Migration 1008: Criar tabela os_eventos e enum
-- Data: 2026-01-07
-- Descrição: Criar estrutura de eventos para timeline da OS,
--            com tipos de evento definidos e metadata JSON flexível
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

BEGIN;

-- Criar enum de tipos de evento
CREATE TYPE os_evento_tipo AS ENUM (
    -- CORE (Obrigatórios ETAPA 3)
    'os_criada',
    'comentario_adicionado',
    'status_alterado',
    
    -- OPCIONAL (ETAPA 3 ou 4)
    'prioridade_alterada',
    'deadline_alterada',
    'profissional_atribuido',
    'profissional_removido',
    
    -- FUTURO (ETAPA 4+)
    'microtask_criada',
    'microtask_concluida',
    'microtask_devolvida',
    'os_excluida'
);

COMMENT ON TYPE os_evento_tipo IS 'Tipos de eventos da OS. Core (ETAPA 3): os_criada, comentario_adicionado, status_alterado';

-- Criar tabela de eventos
CREATE TABLE os_eventos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    os_id UUID NOT NULL REFERENCES tarefas(id) ON DELETE CASCADE,
    tipo os_evento_tipo NOT NULL,
    autor_id UUID REFERENCES profissionais(id) ON DELETE SET NULL, -- NULL = sistema
    metadata JSONB, -- Dados contextuais do evento
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Constraint: metadata deve ser objeto JSON válido ou NULL
    CONSTRAINT metadata_valido CHECK (metadata IS NULL OR jsonb_typeof(metadata) = 'object')
);

-- Índices para performance
CREATE INDEX idx_os_eventos_os_id ON os_eventos(os_id);
CREATE INDEX idx_os_eventos_tipo ON os_eventos(tipo);
CREATE INDEX idx_os_eventos_created_at ON os_eventos(created_at DESC);
CREATE INDEX idx_os_eventos_autor_id ON os_eventos(autor_id) WHERE autor_id IS NOT NULL;

-- Enable RLS
ALTER TABLE os_eventos ENABLE ROW LEVEL SECURITY;

-- Comentários
COMMENT ON TABLE os_eventos IS 'Timeline de eventos da OS. Eventos são IMUTÁVEIS (sem UPDATE/DELETE policies).';
COMMENT ON COLUMN os_eventos.os_id IS 'Referência à OS (tarefa)';
COMMENT ON COLUMN os_eventos.tipo IS 'Tipo do evento (enum)';
COMMENT ON COLUMN os_eventos.autor_id IS 'Profissional que causou o evento. NULL = sistema/automático';
COMMENT ON COLUMN os_eventos.metadata IS 'Dados contextuais em JSON. Estrutura varia por tipo de evento';
COMMENT ON COLUMN os_eventos.created_at IS 'Timestamp de criação do evento (imutável)';

-- Log
DO $$
BEGIN
    RAISE NOTICE '✅ Migration 1008: Tabela os_eventos e enum os_evento_tipo criados';
END $$;

COMMIT;
