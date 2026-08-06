# AutoPublisher — contrato local de templates Placid

## Layers inspecionadas no editor

| Formato | Template | UUID | Dimensões | Mapa lógico inspecionado |
| --- | --- | --- | --- | --- |
| Feed | Template Padrão Feed 2026 | `yeepfqrsxhsjz` | 1080 × 1350 | `headline: titulo-materia`, `news_image: news-image`, `visual_title: selo-png`, `footer_slot_1: patrocinador-1`, `footer_slot_2: patrocinador-2`, `footer_slot_3: patrocinador-3` |
| Reels | Template Padrão Reels 2026 | `z13fdzn6g9glm` | 1080 × 1930 | `headline: titulo-materia`, `visual_title: selo-png`, `footer_slot_1: patrocinador-1`, `footer_slot_2: patrocinador-2`, `footer_slot_3: patrocinador-3` |
| Stories | Template Padrão Storie | `x3djtbgorrtqc` | 1080 × 1930 | `footer_slot_1: patrocinador-1`, `footer_slot_2: patrocinador-2`, `footer_slot_3: patrocinador-3` |

As layers foram identificadas por inspeção visual direta no editor do Placid e o mapa é configuração local tenantizada, nunca constante do renderer. Nenhuma API do Placid foi chamada, nenhuma geração real foi executada, o workspace não foi certificado e os UUIDs não foram confirmados por resposta do provider. Stories footer-only está comprovado pela inspeção visual e pelo contrato local; Feed exige `news_image`, Reels o proíbe e Stories aceita somente os três slots inferiores, sem título, imagem principal ou selo visual.

## Local reversible registration

Run this only against the canonical local Supabase database after replacing `<LOCAL_TEST_TENANT_UUID>`. Keep the feature disabled until a sandbox generation has confirmed all maps. This creates no global configuration and does not call Placid.

```sql
BEGIN;
UPDATE ap.territorial_composer_templates
SET ativo = false
WHERE cliente_id = '<LOCAL_TEST_TENANT_UUID>'::uuid
  AND content_type IN ('feed', 'reels', 'story')
  AND ativo;

INSERT INTO ap.territorial_composer_templates
  (cliente_id, content_type, master_template_uuid, layer_map, ativo)
VALUES
  ('<LOCAL_TEST_TENANT_UUID>'::uuid, 'feed', 'yeepfqrsxhsjz', '{"headline":"titulo-materia","news_image":"news-image","visual_title":"selo-png","footer_slot_1":"patrocinador-1","footer_slot_2":"patrocinador-2","footer_slot_3":"patrocinador-3"}'::jsonb, true),
  ('<LOCAL_TEST_TENANT_UUID>'::uuid, 'reels', 'z13fdzn6g9glm', '{"headline":"titulo-materia","visual_title":"selo-png","footer_slot_1":"patrocinador-1","footer_slot_2":"patrocinador-2","footer_slot_3":"patrocinador-3"}'::jsonb, true),
  ('<LOCAL_TEST_TENANT_UUID>'::uuid, 'story', 'x3djtbgorrtqc', '{"footer_slot_1":"patrocinador-1","footer_slot_2":"patrocinador-2","footer_slot_3":"patrocinador-3"}'::jsonb, true);

INSERT INTO ap.territorial_composer_features (cliente_id, enabled)
VALUES ('<LOCAL_TEST_TENANT_UUID>'::uuid, false)
ON CONFLICT (cliente_id) DO UPDATE SET enabled = false;
COMMIT;
```

To disable locally, set `enabled = false`. To remove these local fixtures, deactivate their rows or remove only rows for the test tenant after confirming the tenant ID. Never use this procedure against production.

## Estado de validação

- Acesso ao provider, credencial autorizada, workspace identificado e autorização de custo continuam pendentes.
- Sandbox, staging e produção permanecem em **NO-GO**.
- O próximo gate exige consulta real das layers, três gerações reais e a matriz das nove combinações no ambiente autorizado.

## Provider gate

Before provider access, require a locally configured and authorized sandbox credential such as `PLACID_SANDBOX_API_TOKEN`, the sandbox workspace identity, written permission to generate against these templates, and explicitly allowed test-generation cost. Do not save the token, Authorization header, signed URLs or real tenant assets in evidence.
