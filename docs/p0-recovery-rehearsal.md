# TVG Hub / AutoPublisher — ensaio de recuperação P0

Data: 9 de setembro de 2026.

## Resultado

```text
DATABASE BACKUPS VERIFIED:
PASS

BACKUP RESTORED TO ISOLATED ENVIRONMENT:
YES — backup lógico criado e restaurado durante este ensaio

SCHEMA VERIFIED:
PASS

MIGRATION HISTORY VERIFIED:
PASS

CRITICAL TABLES VERIFIED:
PASS

REVISED P0 MIGRATION DRY RUN:
PASS

LOGICAL ROLLBACK:
PASS
```

Nenhum restore foi executado sobre produção. Nenhum objeto Storage, cron, secret, Edge Function ou dado remoto foi alterado.

## Capacidade de backup observada

```text
PLATFORM BACKUP TYPE:
PHYSICAL DAILY BACKUP

NUMBER OF AVAILABLE BACKUPS:
8

PITR:
DISABLED

LATEST COMPLETED BACKUP:
2026-09-09T08:14:13.288Z

REGION:
us-west-2

WAL-G:
ENABLED

RESTORE TARGET AVAILABLE:
YES — Restore to a New Project está disponível para projetos pagos com backup físico
```

Os oito backups físicos apareceram como `COMPLETED` em `supabase backups list`. O Supabase documenta que projetos pagos com backup físico podem restaurar uma cópia do banco para um projeto novo. Essa cópia inclui banco, roles e usuários, mas não arquivos ou configurações do Storage, Edge Functions ou demais configurações de plataforma. Consulte [Restore to a new project](https://supabase.com/docs/guides/platform/clone-project) e [Database Backups](https://supabase.com/docs/guides/platform/backups).

O clone gerenciado não foi criado neste ensaio. Ele cria um projeto cobrado e copia extensões, Vault e jobs de banco. O projeto atual contém `pg_cron`, `pg_net` e funções que apontam para endpoints produtivos; a própria documentação manda desativar operações externas depois da clonagem. Isso deixa uma janela entre o provisionamento e a contenção. Para cumprir o requisito de recuperação sem criar efeito externo, foi usada a alternativa oficial de backup lógico com Supabase CLI e restore local. Consulte [Backup and Restore using the CLI](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore).

## Artefatos temporários

Foram exportados, sem Auth e sem arquivos Storage:

| Arquivo temporário | Conteúdo | Tamanho | SHA-256 |
| --- | --- | ---: | --- |
| `schema.sql` | schemas `public` e `ap` | 725.183 bytes | `BADEA2762A4A0E1E7B04D9EE555C3D43F29723122D1BC2AA714388CBF818FA96` |
| `data.sql` | dados `public` e `ap` em `COPY` | 104.591.960 bytes | `2F0119C6871D602E2DA97FC071737F7A2AAB100FFCCD62E95D91ADC8D652FFA8` |
| `history-schema.sql` | schema do ledger | 1.116 bytes | `AE56295C7E66A8B46AB50DF6F00CF57F7866F2478A17FBE3910D9DEF39E836AB` |
| `history-data.sql` | histórico de migrations | 1.095.404 bytes | `0E6562BE3240B6883D33D37EC1066BB3262294CF0F690DF2EC472D181C6CAF78` |

Os arquivos continham dados reais e foram mantidos apenas durante o ensaio local. Depois da coleta das evidências, os dumps e o projeto local `.p0-recovery` foram removidos. Nenhum desses artefatos pertence ao patch.

## Isolamento

O alvo foi um Supabase Postgres 17 local, projeto `p0-recovery`, nas portas `59320–59329`. Serviços de Auth, Realtime, Storage API, PostgREST, Studio, Edge Runtime, analytics e demais containers foram excluídos.

Antes da restauração dos dados, o container PostgreSQL foi desconectado da rede Docker:

```text
container: supabase_db_p0-recovery
networks after disconnect: {}
```

Assim, triggers ou funções recuperadas não podiam executar HTTP, acessar Edge Functions ou alcançar serviços externos. O restore foi feito por `docker exec`, sem conexão de rede.

## Restore executado

Sequência real:

```text
1. supabase db dump --linked --schema public,ap
2. supabase db dump --linked --schema public,ap --data-only --use-copy
3. supabase db dump --linked --schema supabase_migrations
4. supabase db dump --linked --schema supabase_migrations --data-only --use-copy
5. iniciar Postgres Supabase local
6. desconectar o container de todas as redes
7. restaurar schema public/ap em transação
8. restaurar dados com session_replication_role=replica
9. restaurar schema e dados de supabase_migrations
10. validar estrutura e contagens agregadas
11. aplicar a migration P0 revisada
12. executar ciclo de geração, correção, aprovação e rollback lógico
```

O `data.sql` emitiu avisos de FKs circulares em tabelas legadas. A exportação oficial já incluiu `SET session_replication_role = replica`; a restauração concluiu com `ON_ERROR_STOP=1` e exit code zero.

## Base recuperada

| Verificação | Resultado |
| --- | ---: |
| `ap.candidate_news` | 5.750 linhas |
| `ap.collected_news` | 1.189 linhas |
| `ap.news_backlog` | 688 linhas |
| `posted` sem `instagram_post_id` | 3.291 linhas |
| `supabase_migrations.schema_migrations` | 120 versões |
| Última migration restaurada | `20260907224500` |
| RLS em `candidate_news` | habilitada |
| RLS em `collected_news` | habilitada |
| RLS em `news_backlog` | habilitada |
| Constraints nas três tabelas críticas | 33 |
| Funções no schema `ap` antes do P0 | 84 |

Não foi aberto nem inspecionado conteúdo editorial individual.

## Migration P0 revisada sobre o restore

A migration foi aplicada integralmente no banco recuperado. Resultado:

- `ap.render_generations` criada;
- `ap.legacy_publish_attempts` criada;
- ponteiros de geração adicionados sem backfill;
- RPCs P0 criadas e grants aplicados;
- `UNIQUE(asset_path)` presente;
- `p0_reserve_render_asset` presente;
- zero função de domínio `ap/ap_private` anexada a `storage.objects`;
- zero linha histórica em `render_generations`;
- 3.291 `posted` sem ID continuaram intactos.

O hash agregado de todas as linhas de `candidate_news`, removendo apenas as três colunas novas da comparação pós-migration, foi idêntico antes e depois:

```text
before: fef4ad5f9ff554be4d1657e6cc57c9c6
after:  fef4ad5f9ff554be4d1657e6cc57c9c6
```

## Ciclos exercitados

### Duas gerações

```text
generation #1
→ path #1 reservado
→ render concluído
→ voltar para correção
→ editar em changes_requested
→ generation #2
→ path #2 reservado
→ render concluído
→ aprovação explícita de #2
```

Resultado:

```text
status: approved
generations: 2
current_generation_id = approved_generation_id: true
generation #1 preserved: true
paths distinct: true
```

### Path duplicado

Uma segunda geração tentou registrar um `asset_path` já pertencente a outra geração.

```text
duplicate_path:
REJECTED
```

### Upload parcial

Foi reservada uma chave de geração e simulada falha de upload.

```text
generation status: failed
asset_path retained: true
asset_url: null
```

O retry precisa criar nova geração e novo path. O path da tentativa falha não é reutilizado.

### Upload concluído e persistência final falha

Foi reservado o path e simulada rejeição da finalização no banco. A mesma transição de erro usada pelo worker foi executada.

```text
generation status: failed
asset_path retained: true
asset_url: null
error: RENDER_PERSIST_FAILED
```

O objeto potencialmente órfão fica identificável por `generation_id + asset_path`. Ele não é aprovado, publicado, apagado ou reutilizado automaticamente.

## Rollback lógico

Em transação local:

1. os grants de execução dos writers P0 foram retirados;
2. uma consulta com o conjunto de colunas do runtime anterior foi executada como admin autenticado;
3. a leitura retornou registros;
4. a transação foi revertida;
5. as estruturas P0 permaneceram presentes.

```text
legacy runtime read:
PASS

new structures retained:
PASS

asset deletion required:
NO
```

Esse rollback volta frontend/leituras e mantém os writers externos desligados. As versões antigas do renderer, approval path e publisher não devem ser reimplantadas depois da migration, pois não respeitam o novo contrato. A recuperação de backend continua sendo forward fix.

## Conclusão

O procedimento de recuperação do banco relevante para este rollout foi realmente executado em ambiente isolado. Como a migration é aditiva, não reescreve históricos e o rollback operacional mantém as estruturas novas, uma restauração física não é a primeira resposta de rollback.

Storage não foi incluído no backup lógico nem é necessário para reverter este rollout: o deploy não altera objetos antigos e todos os writes novos são append-only. Isso não afirma que Storage possui backup ou restore.
