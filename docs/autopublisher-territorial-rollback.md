# Rollback — administração territorial do AutoPublisher

Este plano deve ser revisado antes de qualquer aplicação remota. Ele não
autoriza migration, deploy, push ou alteração de produção.

## Estratégia preferencial

1. Definir `ap.system_config.territorial_admin_enabled = false` somente para o
   tenant afetado.
2. Confirmar que a aba `Regiões` desapareceu e que `Grupos de selos` e
   `Patrocinadores` continuam disponíveis.
3. Reverter somente o frontend para a versão anterior.
4. Manter as tabelas e os dados territoriais no banco.

Desligar a flag bloqueia também as RPCs de mutação territorial. Nenhuma cidade,
região, associação ou imagem é apagada. Feed, Reels, cadastro antigo de selos,
rotação e geração continuam nos contratos anteriores.

## Preservação de dados

Não fazer rollback destrutivo de:

- `ap.territorial_regions`;
- `ap.territorial_cities`;
- `ap.territorial_region_sponsors`;
- `ap.visual_titles.tipo`;
- objetos imutáveis em `regions/<tenant>/...` e `cities/<tenant>/...`.

O rollback de código deve preservar os IDs, vínculos cidade/selo, assets e
histórico de associações. Objetos eventualmente enviados antes de uma falha de
RPC são content-addressed, não referenciados e podem permanecer no bucket.

## Policies e grants

As policies novas têm nomes exclusivos e não substituem policies existentes:

- `territorial_regions_select_own_client`;
- `territorial_cities_select_own_client`;
- `territorial_region_sponsors_select_own_client`;
- `ap_images_authenticated_insert_regions`;
- `ap_images_authenticated_insert_cities`.

Se uma policy nova precisar ser retirada após a UI e as RPCs serem
desabilitadas, revogar primeiro o `EXECUTE` das RPCs para `authenticated`,
confirmar a flag `false` e somente então remover a policy nominalmente. Nunca
criar uma policy temporária com `USING (true)` e nunca conceder acesso a
`anon`.

Não reabrir `INSERT`, `UPDATE` ou `DELETE` direto nas tabelas territoriais.
Leituras devem permanecer tenantizadas por `ap.get_user_cliente_ids()`.

## Reversibilidade por migration

| Migration | Reversão segura |
|---|---|
| `20260804110000_autopublisher_territorial_schema.sql` | Desabilitar a flag e manter tabelas/coluna. Não dropar dados. |
| `20260804111000_autopublisher_visual_title_type.sql` | Manter coluna, backfill, constraint e default. Removê-los apagaria classificação válida. |
| `20260804112000_autopublisher_region_sponsors.sql` | Manter associações para histórico. |
| `20260804113000_autopublisher_territorial_rls_storage.sql` | Policies novas podem ser revogadas nominalmente após bloquear UI/RPCs; não alterar policies antigas. |
| `20260804114000_autopublisher_territorial_rpcs.sql` | Revogar `EXECUTE` e substituir/reverter apenas as funções novas. Manter tabelas e triggers de integridade enquanto existirem cidades. |

## Mudanças que não devem ser revertidas destrutivamente

- o backfill `editorial`/`cidade`;
- o vínculo único `territorial_cities.visual_title_id`;
- os assets imutáveis já referenciados;
- associações removidas com `removed_at`;
- constraints e foreign keys que impedem cross-tenant;
- triggers que impedem editar um selo gerenciado fora da RPC da cidade.

## Critério de retorno

Depois do rollback do frontend:

- o modal de Nova Matéria deve permanecer no comportamento anterior;
- o payload do Placid deve permanecer byte-a-byte fora desta mudança;
- Feed e Reels devem continuar usando catálogo, snapshots e rotação atuais;
- a ausência de regiões ou a flag desligada não pode ser pré-requisito para
  criar ou gerar matérias.
