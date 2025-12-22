-- Migration: Create empresa_profissionais (company-professional associations) table
-- Description: Many-to-many relationship between companies and professionals with optional sector

CREATE TABLE IF NOT EXISTS empresa_profissionais (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    profissional_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    setor VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    
    -- Prevent duplicate associations
    UNIQUE(empresa_id, profissional_id)
);

-- Indexes for performance (foreign key lookups)
CREATE INDEX idx_empresa_profissionais_empresa ON empresa_profissionais(empresa_id);
CREATE INDEX idx_empresa_profissionais_profissional ON empresa_profissionais(profissional_id);

-- Trigger for updated_at
CREATE TRIGGER update_empresa_profissionais_updated_at
    BEFORE UPDATE ON empresa_profissionais
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Enable RLS
ALTER TABLE empresa_profissionais ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Admin full access
CREATE POLICY "Admin can manage all company-professional associations"
    ON empresa_profissionais
    FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM usuarios
            WHERE usuarios.id = auth.uid()
            AND usuarios.tipo_perfil = 'admin'
        )
    );

-- RLS Policy: Professionals can view their associations
CREATE POLICY "Professionals can view their company associations"
    ON empresa_profissionais
    FOR SELECT
    TO authenticated
    USING (profissional_id = auth.uid());

-- Comments
COMMENT ON TABLE empresa_profissionais IS 'Many-to-many relationship between companies and professionals';
COMMENT ON COLUMN empresa_profissionais.setor IS 'Optional sector/department within the company';
COMMENT ON CONSTRAINT empresa_profissionais_empresa_id_profissional_id_key ON empresa_profissionais IS 'Prevents duplicate company-professional associations';
