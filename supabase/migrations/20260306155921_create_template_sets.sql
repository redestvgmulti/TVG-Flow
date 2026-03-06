CREATE TABLE IF NOT EXISTS ap.template_sets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id UUID NOT NULL,
    label TEXT NOT NULL,
    slug TEXT NOT NULL,
    icon TEXT,
    color TEXT,
    descricao TEXT,
    ativo BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(empresa_id, slug)
);

-- RLS
ALTER TABLE ap.template_sets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Ap Template Sets Full Access" ON ap.template_sets FOR ALL USING (true);
GRANT ALL ON ap.template_sets TO anon, authenticated, service_role;

-- Insert initial values for the fixed client
INSERT INTO ap.template_sets (empresa_id, label, slug, icon, color, descricao) VALUES
('cd287e6e-f273-4d0f-a72d-2a8c391e40e9', 'Padrão', 'default', 'Star', '#eab308', 'Templates ativos no dia a dia'),
('cd287e6e-f273-4d0f-a72d-2a8c391e40e9', 'Individuais', 'individuais', 'User', '#3b82f6', 'Material com um único vereador'),
('cd287e6e-f273-4d0f-a72d-2a8c391e40e9', 'Natal', 'natal', 'Gift', '#ef4444', 'Campanha de final de ano'),
('cd287e6e-f273-4d0f-a72d-2a8c391e40e9', 'Ano Novo', 'ano_novo', 'Sparkles', '#8b5cf6', 'Campanha de ano novo'),
('cd287e6e-f273-4d0f-a72d-2a8c391e40e9', 'Dia das Mulheres', 'dia_das_mulheres', 'Heart', '#ec4899', 'Homenagens de dia das mulheres'),
('cd287e6e-f273-4d0f-a72d-2a8c391e40e9', 'Dia dos Pais', 'dia_dos_pais', 'Award', '#6366f1', 'Homenagens de dia dos pais')
ON CONFLICT (empresa_id, slug) DO NOTHING;
