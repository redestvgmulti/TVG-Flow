# TVG Hub / AutoPublisher — prontidão para implantação P0

Data da revalidação: 9 de setembro de 2026.

## Decisão

```text
READY FOR CONTROLLED P0 DEPLOY:
YES
```

Os dois bloqueadores anteriores foram fechados localmente:

1. a migration P0 não contém mais trigger, função ou dependência de negócio em `storage.objects`;
2. um backup lógico real dos schemas `public/ap` e do histórico de migrations foi restaurado num Postgres Supabase local sem rede; a migration revisada, os dados históricos e o rollback lógico passaram nesse banco recuperado.

Este `YES` libera apenas a preparação de uma janela controlada. Nenhuma ação de produção foi executada. O publisher deve permanecer desligado durante e depois do rollout.

## 1. Base canônica

```text
WORKTREE:
D:/DEV/TVG-Flow/.worktrees/p0-editorial-foundation-20260909

BRANCH:
fix/p0-editorial-foundation-20260909

HEAD:
682e804429deb2a70e999f5e6a08ca97a0b64789

ORIGIN/MAIN LOCAL:
682e804429deb2a70e999f5e6a08ca97a0b64789

ORIGIN/MAIN LIVE:
682e804429deb2a70e999f5e6a08ca97a0b64789

BASE DRIFT DETECTED:
NO
```

O patch continua local, sem commit, push ou deploy. `public/system-version.json`, alterado automaticamente pelo build, foi restaurado ao HEAD.

## 2. Trigger problemático identificado

Antes da revisão:

```text
STORAGE TRIGGER:
render_storage_object_immutable

FUNCTION:
ap_private.guard_render_object_p0()

TABLE:
storage.objects

PURPOSE:
Recusar UPDATE e DELETE de objetos no bucket ap-renders, permitindo apenas timestamps técnicos.

WHY IT WAS ADDED:
Impedir que Render #2 substituísse ou apagasse os bytes do Render #1, inclusive quando o writer usasse service_role.

APPLICATION INVARIANT PROTECTED:
Cada geração revisada deve continuar associada aos bytes originais que o humano viu.
```

O mecanismo protegia uma invariante válida no local errado. O schema `storage` é gerenciado pelo Supabase e não deve hospedar triggers de domínio. A orientação oficial é tratá-lo como somente leitura do ponto de vista estrutural da aplicação. Consulte [Storage Schema](https://supabase.com/docs/guides/storage/schema/design).

## 3. Migration revisada

Foram removidos integralmente:

```text
ap_private.guard_render_object_p0()
render_storage_object_immutable
CREATE TRIGGER ... ON storage.objects
```

A migration P0 agora cria e altera somente objetos de domínio em `ap` e `ap_private`.

```text
CUSTOM TRIGGERS ON storage.objects:
0

CUSTOM DOMAIN FUNCTIONS ATTACHED TO storage.objects:
0

TOUCHES storage.objects STRUCTURE:
NO

CREATES storage.objects TRIGGER:
NO

DELETES EXISTING STORAGE OBJECT:
NO

MODIFIES EXISTING STORAGE OBJECT:
NO
```

Policies RLS suportadas já existentes em migrations históricas não foram removidas ou alteradas. Elas são controle de acesso da API Storage e não fazem parte da migration P0.

### Diff lógico

Antes:

```text
application schema
+ trigger de domínio em storage.objects
```

Depois:

```text
application schema only
+ generation-owned unique asset_path
+ reserva do path antes do upload
+ upload append-only com upsert=false
```

## 4. Imutabilidade sem internals do Storage

### Path por geração

O worker constrói exclusivamente:

```text
{cliente_id}/{candidate_id}/{generation_id}.png
{cliente_id}/{candidate_id}/{generation_id}.jpg
```

Os três identificadores precisam ser UUIDs válidos. Cada nova execução recebe um novo `generation_id`, portanto uma correção produz outro object path.

### Domínio `ap`

`ap.render_generations` permanece como fonte de verdade:

- `id` da geração;
- candidato e tenant;
- snapshot e plano Placid;
- `asset_path`;
- `asset_url`;
- status e timestamps;
- erro técnico.

`asset_path text UNIQUE` impede duas gerações de registrar o mesmo objeto. O teste PostgreSQL e o banco restaurado recusaram a colisão.

### Reserva antes do upload

Foi adicionada `ap.p0_reserve_render_asset(generation_id, asset_path)`. Ela:

1. exige worker de serviço;
2. bloqueia geração e candidato;
3. exige geração atual em `rendering`, plano já congelado e candidato em `pending_render`;
4. exige o path exato derivado de tenant, candidato, geração e extensão;
5. grava o path uma única vez antes do upload.

O fluxo ficou:

```text
begin generation
→ persist render plan
→ derive unique path
→ reserve path in ap.render_generations
→ upload new object with upsert=false
→ complete generation using the same reserved path
```

`p0_complete_render` agora recusa um path diferente do previamente reservado.

### Sem replace

O único writer do bucket `ap-renders` usa:

```js
.upload(path, bytes, { contentType, upsert: false })
```

Não existe `.update()`, `.move()`, `.remove()` ou `upsert: true` no writer de geração.

## 5. Writers de Storage

| Writer | Operação | Bucket | Pode sobrescrever render? | Ação |
| --- | --- | --- | --- | --- |
| `ap-render-engine/generationWorkflow.mjs` | `upload`, `upsert:false` | `ap-renders` | Não; path contém `generation_id` | Mantido e protegido por testes. |
| `ap-image-fetcher` | `upload`, `upsert:true` | `ap-images` | Não escreve render; substitui cache da imagem-fonte por candidate ID | Legado fora deste P0; não alterado. |
| `AutoPublisher.jsx` | `upload` | `ap-images/admin_uploads` | Não escreve `ap-renders`; nome usa timestamp/random | Mantido. |
| `EmployeeMode.jsx` | `upload` | `ap-images/employee_uploads` | Não escreve `ap-renders`; nome usa timestamp/random | Mantido. |
| `masterV1Assets.js` | `upload`, `upsert:false` | `ap-images` | Não escreve render | Mantido. |
| `fileService.js` | `upload` e compensação `remove` | `task-attachments` | Não | Fora do editorial. |
| `profileService.js` | `upload`, `upsert:false`, compensação `remove` | `avatars` | Não | Fora do editorial. |
| `AdminContent.jsx` | `upload`, `upsert:false`, `remove` | `assistant-images` | Não | Legado de Assistentes; fora do P0. |
| `delete-task-attachment` | `remove` | `task-attachments` | Não | Fora do editorial. |

```text
UPLOAD NEW OBJECT:
YES

UPDATE EXISTING RENDER:
NO

UPSERT EXISTING RENDER:
NO

DELETE OLD RENDER:
NO
```

## 6. Falhas parciais e reconciliação

### Geração criada e upload falha

O path já está reservado na geração. O handler chama `p0_fail_render`, deixando:

```text
status = failed
asset_path = path reservado
asset_url = null
error_code = RENDER_STORAGE_UPLOAD_FAILED
```

O retry cria uma geração nova. Não reutiliza o path anterior e não apaga a tentativa.

### Upload termina e persistência final falha

O objeto potencialmente órfão é localizável por `generation_id + asset_path`, pois o path foi persistido antes do upload. O catch chama `p0_fail_render`; se até essa persistência falhar, a geração permanece `rendering` com path reservado e o recovery pode identificá-la pelo lease.

O sistema não aprova, publica, reutiliza ou apaga automaticamente esse objeto. Uma futura reconciliação pode conferir a existência do path e o status da geração. Não foi criado garbage collector destrutivo nesta fase.

## 7. Risco e rollback do Storage

```text
OLD STORAGE MUTATION DURING DEPLOY:
NO

OLD STORAGE DELETE:
NO

OLD STORAGE MOVE:
NO

OLD STORAGE OVERWRITE:
NO

NEW STORAGE WRITE MODEL:
APPEND-ONLY

STORAGE RESTORE REQUIRED FOR P0 ROLLBACK:
NO
```

Essa conclusão é específica deste rollout. A migration não lê nem escreve objetos; Functions novas só criam novos paths. Em rollback, os objetos novos podem permanecer sem prejudicar o runtime anterior. Não se afirma que Supabase Storage possua backup, versionamento ou restore. Backups de banco não incluem os bytes do Storage, conforme [Database Backups](https://supabase.com/docs/guides/platform/backups).

## 8. Recuperação do banco

```text
BACKUP TYPE:
8 physical daily backups disponíveis na plataforma

NUMBER OF AVAILABLE BACKUPS:
8

PITR:
DISABLED

LATEST COMPLETED BACKUP:
2026-09-09T08:14:13.288Z

RESTORE TARGET AVAILABLE:
YES
```

O Supabase oferece `Restore to a New Project` para este cenário pago com backups físicos. Esse caminho não foi acionado porque criaria um projeto cobrado e copiaria `pg_cron`, `pg_net`, Vault e funções com endpoints externos antes da contenção. A documentação alerta que essas operações externas precisam ser desativadas no clone. Consulte [Restore to a new project](https://supabase.com/docs/guides/platform/clone-project).

Foi executada a alternativa oficial de recuperação lógica:

```text
export public/ap schema and data
+ export supabase_migrations schema and data
→ restore in isolated Supabase Postgres 17
→ disconnect container from every network before data restore
→ validate schema, RLS, constraints, functions and aggregate counts
→ apply revised P0 migration
→ execute lifecycle and rollback tests
```

Resultado:

```text
BACKUP RESTORED TO ISOLATED ENVIRONMENT:
YES

SCHEMA VERIFIED:
PASS

MIGRATION HISTORY VERIFIED:
PASS

CRITICAL TABLES VERIFIED:
PASS
```

Foram recuperados 5.750 `candidate_news`, 1.189 `collected_news`, 688 `news_backlog` e 120 versões de migration. RLS estava habilitada nas três tabelas críticas. Nenhum conteúdo editorial individual foi aberto. O procedimento completo, hashes e limites estão em [p0-recovery-rehearsal.md](p0-recovery-rehearsal.md).

## 9. Migration revisada sobre o banco recuperado

A migration passou integralmente sobre o schema e dados recuperados.

O hash agregado de todas as linhas históricas de `candidate_news`, removendo somente as três colunas novas da comparação pós-migration, foi idêntico:

```text
before: fef4ad5f9ff554be4d1657e6cc57c9c6
after:  fef4ad5f9ff554be4d1657e6cc57c9c6
```

Os 3.291 `posted` sem `instagram_post_id` permaneceram 3.291. Nenhuma geração ou aprovação foi inventada para registros históricos.

No banco recuperado, fixtures sintéticas confirmaram:

- Render #1 e Render #2 com paths distintos;
- geração #1 preservada;
- aprovação vinculada somente à geração #2;
- path duplicado rejeitado;
- falha de upload com geração/path preservados;
- falha de persistência final com órfão identificável;
- zero trigger de domínio em `storage.objects`.

```text
REVISED P0 MIGRATION DRY RUN:
PASS
```

## 10. Rollback lógico

O ensaio retirou em transação as permissões dos writers P0 e executou uma consulta com as colunas esperadas pelo runtime anterior como admin autenticado. A leitura passou; a transação foi revertida e as estruturas novas permaneceram.

```text
new writers disabled
→ previous frontend/read path available
→ new tables and columns retained
→ historical rows readable
→ no Storage object deleted
```

As antigas Functions de render, aprovação e publicação continuam incompatíveis e não devem ser reimplantadas depois da migration. O rollback de backend é contenção mais forward fix; o frontend pode voltar ao deployment anterior identificado.

```text
LOGICAL ROLLBACK:
PASS
```

## 11. Testes finais

| Verificação | Resultado |
| --- | --- |
| P0 publicação/render/Storage/UI | 21 PASS |
| P0 PostgreSQL, histórico e concorrência | 11 PASS |
| Total P0 | **32 PASS / 0 FAIL** |
| Suíte ampliada | 425 total / 408 pass / 9 fail / 8 skip |
| Comparação das nove falhas | Mesmas identidades e motivos da base; 0 regressões |
| Lint direcionado | PASS |
| Lint global | 225 erros / 39 avisos, igual à base |
| Typecheck das quatro Edge Functions | PASS |
| Build Vite/PWA | PASS |
| `git diff --check` | PASS |
| Migration no banco recuperado | PASS |
| Path duplicado | REJECTED |
| Rollback lógico | PASS |

Dois testes foram acrescentados aos 30 P0 anteriores para cobrir reserva antes do upload e ausência de dependência do Storage interno. As mesmas nove falhas preexistentes permanecem formalmente classificadas; nenhuma é regressão deste patch.

## 12. Arquivos alterados nesta correção

- `supabase/migrations/20260909014825_p0_editorial_publication_render_invariants.sql`
- `supabase/functions/ap-render-engine/generationWorkflow.mjs`
- `supabase/functions/ap-render-engine/index.ts`
- `tests/p0/fixture.sql`
- `tests/p0/postgres.test.mjs`
- `tests/p0/render.test.mjs`
- `docs/p0-production-readiness-report.md`
- `docs/p0-production-deploy-runbook.md`
- `docs/p0-recovery-rehearsal.md`
- `docs/p0-changed-files.txt`

## 13. Produção

| Item | Alterado |
| --- | --- |
| Banco/schema/dados | NO |
| Storage | NO |
| Edge Functions | NO |
| Frontend | NO |
| Deploy | NO |
| Secrets | NO |
| Crons | NO |
| Dados históricos | NO |
| Instagram / Placid / Apify | NO |

## 14. Gate final

```text
STORAGE SCHEMA CUSTOMIZATION:
NONE

CUSTOM TRIGGER ON storage.objects:
NO

RENDER PATH UNIQUE:
PASS

RENDER UPSERT DISABLED:
PASS

OLD STORAGE ASSETS MUTATED:
NO

NEW STORAGE MODEL APPEND-ONLY:
PASS

STORAGE RESTORE REQUIRED FOR THIS ROLLOUT:
NO

DATABASE BACKUPS VERIFIED:
PASS

DATABASE RESTORE REHEARSAL:
PASS

RESTORED SCHEMA VALIDATED:
PASS

REVISED P0 MIGRATION DRY RUN:
PASS

P0 TESTS:
PASS

NEW REGRESSIONS:
0

LOGICAL ROLLBACK:
PASS

PUBLISHER DEFAULT DISABLED:
PASS

CONTROLLED DEPLOY RUNBOOK:
PASS

READY FOR CONTROLLED P0 DEPLOY:
YES
```

O próximo passo permitido é revisar este gate e, em uma etapa explicitamente autorizada, executar o runbook controlado. Fase 2B continua fora de escopo.

