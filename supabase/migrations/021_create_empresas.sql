-- Migration: Create empresas (companies) table
-- Description: Companies/clients management table with basic info and active status

CREATE TABLE IF NOT EXISTS empresas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nome VARCHAR(255) NOT NULL,
    ativo BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Index for active companies (commonly filtered)
CREATE INDEX idx_empresas_ativo ON empresas(ativo);

-- Index for name searches
CREATE INDEX idx_empresas_nome ON empresas(nome);

-- Trigger for updated_at
CREATE TRIGGER update_empresas_updated_at
    BEFORE UPDATE ON empresas
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Enable RLS
ALTER TABLE empresas ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Admin full access
CREATE POLICY "Admin can manage all companies"
    ON empresas
    FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM usuarios
            WHERE usuarios.id = auth.uid()
            AND usuarios.tipo_perfil = 'admin'
        )
    );

-- RLS Policy: Professionals can view their companies
CREATE POLICY "Professionals can view their companies"
    ON empresas
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM empresa_profissionais
            WHERE empresa_profissionais.empresa_id = empresas.id
            AND empresa_profissionais.profissional_id = auth.uid()
        )
    );

-- Comment
COMMENT ON TABLE empresas IS 'Companies/clients table for multi-company operations management';
COMMENT ON COLUMN empresas.nome IS 'Company name';
COMMENT ON COLUMN empresas.ativo IS 'Whether company is active';
