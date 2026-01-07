-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- Migration 1011: Criar tabela notificacoes
-- Data: 2026-01-07
-- Descrição: Criar estrutura de notificações in-app baseadas em eventos
--            para manter participantes informados sobre novidades na OS
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

BEGIN;

-- Criar tabela de notificações
CREATE TABLE notificacoes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profissional_id UUID NOT NULL REFERENCES profissionais(id) ON DELETE CASCADE,
    os_id UUID REFERENCES tarefas(id) ON DELETE CASCADE,
    evento_id UUID REFERENCES os_eventos(id) ON DELETE CASCADE,
    tipo VARCHAR(50) NOT NULL,
    titulo TEXT NOT NULL,
    mensagem TEXT,
    lida BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Constraint: deve ter referência a OS ou evento
    CONSTRAINT tem_referencia CHECK (os_id IS NOT NULL OR evento_id IS NOT NULL)
);

-- Índices para performance
CREATE INDEX idx_notificacoes_profissional ON notificacoes(profissional_id);
CREATE INDEX idx_notificacoes_lida ON notificacoes(lida) WHERE lida = false;
CREATE INDEX idx_notificacoes_created_at ON notificacoes(created_at DESC);
CREATE INDEX idx_notificacoes_os_id ON notificacoes(os_id) WHERE os_id IS NOT NULL;

-- Enable RLS
ALTER TABLE notificacoes ENABLE ROW LEVEL SECURITY;

-- Policy: Ver próprias notificações
CREATE POLICY "Ver próprias notificações"
ON notificacoes FOR SELECT
TO authenticated
USING (profissional_id = auth.uid());

-- Policy: Marcar como lida
CREATE POLICY "Marcar como lida"
ON notificacoes FOR UPDATE
TO authenticated
USING (profissional_id = auth.uid())
WITH CHECK (
    profissional_id = auth.uid()
    -- Apenas permite UPDATE em 'lida'
    AND lida IN (true, false)
);

-- Policy: Criar notificação (apenas sistema/triggers)
CREATE POLICY "Sistema cria notificações"
ON notificacoes FOR INSERT
TO authenticated
WITH CHECK (profissional_id IS NOT NULL);

-- Comentários
COMMENT ON TABLE notificacoes IS 'Notificações in-app para profissionais sobre eventos em OSs';
COMMENT ON COLUMN notificacoes.profissional_id IS 'Destinatário da notificação';
COMMENT ON COLUMN notificacoes.os_id IS 'OS relacionada (opcional)';
COMMENT ON COLUMN notificacoes.evento_id IS 'Evento que gerou a notificação (opcional)';
COMMENT ON COLUMN notificacoes.tipo IS 'Tipo da notificação (corresponde a os_evento_tipo)';
COMMENT ON COLUMN notificacoes.titulo IS 'Título curto da notificação';
COMMENT ON COLUMN notificacoes.mensagem IS 'Texto completo da notificação';
COMMENT ON COLUMN notificacoes.lida IS 'Se notificação foi visualizada';

-- Log
DO $$
BEGIN
    RAISE NOTICE '✅ Migration 1011: Tabela notific acoes criada com RLS';
END $$;

COMMIT;
