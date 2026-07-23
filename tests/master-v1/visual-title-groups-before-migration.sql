\set ON_ERROR_STOP on

INSERT INTO public.clientes (id, nome)
VALUES
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Client A'),
    ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Client B'),
    ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Client C');

INSERT INTO public.cliente_profissionais (cliente_id, profissional_id, ativo)
VALUES
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', true),
    ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '22222222-2222-4222-8222-222222222222', true);

INSERT INTO ap.visual_titles (
    id,
    cliente_id,
    nome,
    slug,
    asset_bucket,
    asset_path,
    asset_version,
    sha256,
    formatos,
    ativo,
    ordem
)
VALUES
    (
        'd0000000-0000-4000-8000-000000000001',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'Esporte',
        'esporte',
        'ap-images',
        'visual-titles/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/esporte/a.png',
        'version-a',
        repeat('a', 64),
        ARRAY['feed', 'reels']::text[],
        true,
        3
    ),
    (
        'd0000000-0000-4000-8000-000000000002',
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        'Urgente',
        'urgente',
        'ap-images',
        'visual-titles/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/urgente/b.png',
        'version-b',
        repeat('b', 64),
        ARRAY['feed']::text[],
        false,
        7
    );
