CREATE TABLE IF NOT EXISTS ap.template_sets (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id uuid NOT NULL,
    label text NOT NULL,
    slug text NOT NULL,
    icon text,
    color text,
    descricao text,
    ativo boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (empresa_id, slug)
);

ALTER TABLE ap.template_sets
    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Ap Template Sets Full Access"
    ON ap.template_sets;

CREATE POLICY "Ap Template Sets Full Access"
    ON ap.template_sets
    FOR ALL
    USING (true)
    WITH CHECK (true);

GRANT ALL
    ON ap.template_sets
    TO anon, authenticated, service_role;

-- Seed only when the original tenant already exists.
-- Fresh local databases must not receive production-specific tenant data.
INSERT INTO ap.template_sets (
    empresa_id,
    label,
    slug,
    icon,
    color,
    descricao
)
SELECT
    clientes.id,
    seed.label,
    seed.slug,
    seed.icon,
    seed.color,
    seed.descricao
FROM public.clientes AS clientes
CROSS JOIN (
    VALUES
        (
            'Padrão',
            'default',
            'Star',
            '#eab308',
            'Templates ativos no dia a dia'
        ),
        (
            'Individuais',
            'individuais',
            'User',
            '#3b82f6',
            'Material com um único vereador'
        ),
        (
            'Natal',
            'natal',
            'Gift',
            '#ef4444',
            'Campanha de final de ano'
        ),
        (
            'Ano Novo',
            'ano_novo',
            'Sparkles',
            '#8b5cf6',
            'Campanha de ano novo'
        ),
        (
            'Dia das Mulheres',
            'dia_das_mulheres',
            'Heart',
            '#ec4899',
            'Homenagens de Dia das Mulheres'
        ),
        (
            'Dia dos Pais',
            'dia_dos_pais',
            'Award',
            '#6366f1',
            'Homenagens de Dia dos Pais'
        )
) AS seed (
    label,
    slug,
    icon,
    color,
    descricao
)
WHERE clientes.id =
    'cd287e6e-f273-4d0f-a72d-2a8c391e40e9'
ON CONFLICT (empresa_id, slug) DO NOTHING;
