# TVG Hub / AutoPublisher — runbook de implantação controlada P0

Data de preparação: 9 de setembro de 2026.

## Estado deste runbook

Este documento é executável somente depois que o relatório de prontidão registrar `READY FOR CONTROLLED P0 DEPLOY: YES` e houver autorização explícita para produção.

O gate técnico atual está em `YES`, mas esta etapa não autorizou deploy. **Não executar ainda.** A implantação continua sendo uma ação de produção separada e explicitamente controlada.

Atualização de 17/09/2026: o patch descrito neste runbook foi commitado e enviado ao GitHub, e está sob revisão em [PR #11](https://github.com/redestvgmulti/TVG-Flow/pull/11) (`fix/p0-editorial-foundation-20260909` → `main`). Este runbook só deve ser executado depois que o PR #11 for revisado e mesclado; a partir daí, a fonte de verdade para deploy passa a ser o commit de merge em `origin/main`, não mais o worktree local isolado. As seções abaixo que referenciam o worktree de preparação continuam válidas como registro histórico da validação local, mas o "release SHA" real é o merge commit do PR #11.

A migration revisada não modifica o schema `storage`. O preflight mantém uma verificação fail-closed para impedir que essa dependência reapareça antes da janela.

Projeto Supabase: `gyooxmpyxncrezjiljrj`.

Frontend anterior conhecido:

```text
GitHub deployment: 6147956584
SHA: 682e804429deb2a70e999f5e6a08ca97a0b64789
Status: success
Vercel URL: https://tvg-flow-qs1o0lwb6-tvg-multis-projects.vercel.app
```

## Papéis durante a janela

- **Release operator:** executa CLI, registra saída e controla a ordem.
- **Database observer:** acompanha queries, locks, erros e contagens históricas.
- **Editorial operator:** bloqueia criação, aprovação e render manual durante a troca.
- **Go/no-go owner:** autoriza cada passagem e manda abortar se uma condição for atingida.

Uma pessoa pode acumular papéis, mas cada validação precisa ter nome, hora e resultado registrados fora do banco de produção.

## 0. Precondições que precisam estar verdes

Depois do merge do PR #11, clonar/atualizar um checkout limpo de `main` (não o worktree local isolado):

```powershell
$ErrorActionPreference = 'Stop'
git fetch origin
git log -1 --format='%H %D %s' origin/main
git rev-parse origin/main
git ls-remote origin refs/heads/main
git diff --check HEAD

$unsupportedStorageMutation = Select-String `
  -LiteralPath 'supabase\migrations\20260909014825_p0_editorial_publication_render_invariants.sql' `
  -Pattern 'storage\.'
if ($unsupportedStorageMutation) {
  throw 'ABORT: P0 migration references a managed Storage schema'
}
```

Confirmar também que o merge commit de `origin/main` contém exatamente o diff do PR #11 (nenhum arquivo de R1, Radar Instagram ou Flow.IA misturado — ver classificação de escopo no PR) e que as quatro migrations `native_chat`/Flow.IA (`20260907183019`, `20260907201345`, `20260907213000`, `20260907224500`) permanecem deliberadamente fora deste merge (reconciliação tratada em PR separado; o ledger remoto já as tem aplicadas por versão, então `db push` nunca tentará reaplicá-las).

Abortar se:

- o merge commit em `origin/main` não corresponder ao PR #11 aprovado;
- `origin/main` tiver drift material ainda não ensaiado;
- houver arquivos inesperados (R1, Radar Instagram, Flow.IA) no merge;
- `git diff --check` falhar;
- a migration ainda modificar diretamente `storage.objects`;
- os 32 testes P0, o Deno typecheck das quatro Edge Functions alteradas, o build ou o lint direcionado não passarem;
- qualquer falha herdada pré-existente mudar de identidade ou motivo em relação ao classificado em `docs/p0-static-test-results.txt`.

## 1. Inventário remoto imediatamente antes da janela

```powershell
npx supabase link --project-ref gyooxmpyxncrezjiljrj
npx supabase migration list --linked
npx supabase functions list --project-ref gyooxmpyxncrezjiljrj
npx supabase backups list --project-ref gyooxmpyxncrezjiljrj
npx supabase secrets list --project-ref gyooxmpyxncrezjiljrj
npx supabase db push --dry-run --linked
```

O `db push --dry-run` deve listar **somente** a migration P0 aprovada. Não usar `--include-all`. Não continuar se houver migration desconhecida, divergência de ledger, backup incompleto ou projeto diferente.

Registrar o backup físico concluído mais recente. O restore lógico foi ensaiado e está documentado em `docs/p0-recovery-rehearsal.md`. Não prometer recuperação de arquivos Storage: os backups do banco não contêm seus bytes e este rollout não precisa alterar objetos antigos.

## 2. Baseline SQL somente leitura

Executar no SQL Editor ou por conexão administrativa autorizada:

```sql
select
  count(*) filter (where status = 'raw')                    as raw,
  count(*) filter (where status = 'processing')             as processing,
  count(*) filter (where status = 'ready_for_scoring')      as ready_for_scoring,
  count(*) filter (where status = 'scored')                 as scored,
  count(*) filter (where status = 'selected')               as selected,
  count(*) filter (where status = 'pending_render')         as pending_render,
  count(*) filter (where status = 'pending_review')         as pending_review,
  count(*) filter (where status = 'approved')               as approved,
  count(*) filter (where status = 'queued_for_posting')     as queued_for_posting,
  count(*) filter (where status = 'posted')                 as posted,
  count(*) filter (where status = 'posted' and instagram_post_id is null)
                                                            as posted_without_id,
  count(*) filter (where status = 'rejected')               as rejected,
  count(*) filter (where status = 'failed')                 as failed
from ap.candidate_news;

select jobid, jobname, schedule, active, command
from cron.job
where jobname in (
  'ap-content-production',
  'ap-render-engine',
  'ap-render-recovery',
  'ap-instagram-publisher'
)
order by jobname;
```

Registrar também:

- quantidade de objetos no bucket `ap-renders`, sem listar conteúdo sensível;
- baseline de erros das quatro Functions;
- ausência de cron para `ap-instagram-publisher`;
- `AP_LEGACY_PUBLISH_ENABLED` ausente ou diferente de `true`.

Abortar se houver `processing`, `pending_render` ou `queued_for_posting` antes do freeze. `selected` pode ser drenado antes da pausa, mas deve chegar a zero.

## 3. Freeze editorial e pausa seletiva

Comunicar que, durante a janela, ficam indisponíveis:

- criação manual que dispare produção/render;
- aprovação;
- voltar para correção;
- publicação.

Radar, coleta, scraping, scoring e leitura de históricos podem continuar.

Pausar por nome, recusando zero ou múltiplos jobs:

```sql
do $$
declare
  v_job record;
begin
  for v_job in
    select jobid, jobname
    from cron.job
    where jobname in ('ap-render-engine', 'ap-content-production')
  loop
    perform cron.alter_job(job_id := v_job.jobid, active := false);
  end loop;

  if (select count(*) from cron.job
      where jobname in ('ap-render-engine', 'ap-content-production')) <> 2 then
    raise exception 'ABORT: expected exactly two rollout jobs';
  end if;
end $$;
```

O `ap-render-recovery` deve permanecer inativo. Não existe motivo para desligar ingestion, image fetcher, scoring ou daily feed builder.

Após a pausa, executar a query de baseline duas vezes, com intervalo superior a um ciclo antigo do renderer. Esperado:

```text
processing = 0
selected = 0
pending_render = 0
queued_for_posting = 0
```

Se qualquer job permanecer em voo, não reconciliar por UPDATE manual. Identificar seu lock/lease e abortar a troca até a conclusão ou investigação.

## 4. Fixar publisher em desligado

Executar antes do deploy da Function:

```powershell
npx supabase secrets set AP_LEGACY_PUBLISH_ENABLED=false --project-ref gyooxmpyxncrezjiljrj
```

Verificar somente o nome do secret, sem imprimir valores:

```powershell
npx supabase secrets list --project-ref gyooxmpyxncrezjiljrj
```

Não criar cron do publisher. Não fazer chamada de teste contra Instagram.

## 5. Deploy das Edge Functions compatíveis

Com os writers congelados:

```powershell
npx supabase functions deploy ap-instagram-publisher --project-ref gyooxmpyxncrezjiljrj
npx supabase functions deploy ap-render-engine --project-ref gyooxmpyxncrezjiljrj
npx supabase functions deploy ap-render-recovery --project-ref gyooxmpyxncrezjiljrj
npx supabase functions deploy ap-content-production --project-ref gyooxmpyxncrezjiljrj
npx supabase functions list --project-ref gyooxmpyxncrezjiljrj
```

Esse estado transitório é aceito somente sob freeze. As Functions P0 que dependem das RPCs novas devem falhar fechadas antes de qualquer chamada Placid/Graph. Não testar provocando efeito externo.

Abortar se qualquer Function falhar no deploy ou se seus logs mostrarem execução externa durante a janela.

## 6. Migration

Repetir o dry run:

```powershell
npx supabase db push --dry-run --linked
```

Continuar apenas se a saída contiver exatamente a migration P0 aprovada. Aplicar:

```powershell
npx supabase db push --linked
npx supabase migration list --linked
```

Não usar `migration repair`, `--include-all`, SQL manual parcial ou reaplicação das migrations Flow.IA.

Postflight imediato:

```sql
select
  to_regclass('ap.render_generations')       as render_generations,
  to_regclass('ap.legacy_publish_attempts')  as legacy_publish_attempts;

select column_name, is_nullable, data_type
from information_schema.columns
where table_schema = 'ap'
  and table_name = 'candidate_news'
  and column_name in (
    'current_generation_id',
    'approved_generation_id',
    'correction_draft'
  )
order by column_name;

select routine_name
from information_schema.routines
where routine_schema = 'ap'
  and routine_name like 'p0_%'
order by routine_name;

select event_object_schema, event_object_table, trigger_name
from information_schema.triggers
where trigger_schema = 'ap'
  and trigger_name like 'p0_%'
order by event_object_table, trigger_name;

select count(*) as custom_domain_triggers_on_storage_objects
from pg_trigger trigger
join pg_class relation on relation.oid=trigger.tgrelid
join pg_namespace relation_schema on relation_schema.oid=relation.relnamespace
join pg_proc function on function.oid=trigger.tgfoid
join pg_namespace function_schema on function_schema.oid=function.pronamespace
where not trigger.tgisinternal
  and relation_schema.nspname='storage'
  and relation.relname='objects'
  and function_schema.nspname in ('ap','ap_private');
```

`custom_domain_triggers_on_storage_objects` precisa ser zero. Confirmar também que `p0_reserve_render_asset` aparece entre as RPCs e que `asset_path` possui constraint `UNIQUE`.

Repetir a contagem de históricos. `posted_without_id`, os 856 `pending_review` legados e os 121 `approved` legados só podem divergir se atividade legítima e previamente explicada ocorreu. A migration em si deve alterar zero linhas existentes.

## 7. Deploy do frontend

Publicar o commit de release aprovado pelo fluxo Git/Vercel existente. Registrar o SHA exato e aguardar o status `success` do deployment de produção.

Consulta de verificação:

```powershell
gh api "repos/redestvgmulti/TVG-Flow/deployments?environment=Production&per_page=5" `
  --jq ".[] | [.id,.sha,.ref,.environment,.created_at,.task] | @tsv"
```

Não liberar operadores se o SHA implantado não for exatamente o SHA P0 aprovado.

## 8. Validação pós-deploy sem efeito externo

Com renderer, recovery, content production e publisher ainda pausados/desligados:

1. Abrir a lista e detalhes de matérias históricas.
2. Confirmar que `posted` sem ID aparece como histórico sem comprovação, sem botão que simule sucesso.
3. Confirmar que `pending_review` legado sem geração continua visualizável e não pode ser aprovado por inferência.
4. Confirmar que uma matéria nova pós-render não oferece edição direta; usar somente dados já existentes, sem disparar novo render.
5. Confirmar que “Voltar para correção” exige motivo e não altera a geração observada até a submissão editorial posterior.
6. Conferir Functions e logs; nenhuma chamada `/media`, `/media_publish` ou Placid pode ter ocorrido.
7. Conferir que recovery continua inativo e não existe cron do publisher.
8. Conferir que `AP_LEGACY_PUBLISH_ENABLED` permanece `false`.

Não fabricar geração ou tentativa diretamente no banco de produção. A validação de asset único foi concluída em ambiente isolado; o primeiro render orgânico após a retomada deve ser monitorado e precisa usar `{generation_id}` no path, `upsert=false` e uma linha correspondente em `ap.render_generations`.

## 9. Retomada controlada

Se todos os checks passarem, reativar somente os dois crons pausados:

```sql
do $$
declare
  v_job record;
begin
  for v_job in
    select jobid, jobname
    from cron.job
    where jobname in ('ap-render-engine', 'ap-content-production')
  loop
    perform cron.alter_job(job_id := v_job.jobid, active := true);
  end loop;

  if (select count(*) from cron.job
      where jobname in ('ap-render-engine', 'ap-content-production') and active) <> 2 then
    raise exception 'ABORT: rollout jobs were not both resumed';
  end if;
end $$;
```

Manter:

```text
ap-render-recovery: inactive
ap-instagram-publisher cron: absent
AP_LEGACY_PUBLISH_ENABLED: false
```

Remover o freeze editorial. Monitorar o primeiro ciclo de `ap-content-production` e `ap-render-engine`. Se surgir o primeiro render orgânico, validar:

- geração criada antes do upload;
- path contém o UUID da geração;
- `current_generation_id` aponta para ela;
- asset anterior, se houver, continua acessível;
- status final é `pending_review`, não `approved`;
- nenhum novo `posted` sem ID foi criado.

## 10. Condições de abort

Abortar e iniciar contenção se ocorrer qualquer um destes eventos:

- migration diferente da ensaiada;
- migration tenta modificar `storage.objects` ou outro schema gerenciado;
- erro inesperado de constraint, grant, RLS, trigger ou função;
- writer antigo grava durante a janela;
- qualquer chamada Graph/Placid inesperada;
- render usa path sem `generation_id`, faz overwrite ou não persiste geração;
- conteúdo editorial é aceito depois do render;
- aprovação ocorre sem `approved_generation_id` válido;
- qualquer registro histórico recebe geração, ID externo, permalink ou status inventado;
- surge novo `posted` sem `instagram_post_id`;
- aumenta a taxa de erro das Functions de forma material;
- recovery ou publisher são ativados;
- frontend de produção aponta para SHA diferente do aprovado.

## 11. Contenção e rollback

Primeiro conter writers:

```sql
do $$
declare
  v_job record;
begin
  for v_job in
    select jobid
    from cron.job
    where jobname in (
      'ap-content-production',
      'ap-render-engine',
      'ap-render-recovery'
    )
  loop
    perform cron.alter_job(job_id := v_job.jobid, active := false);
  end loop;
end $$;
```

Fixar publisher desligado:

```powershell
npx supabase secrets set AP_LEGACY_PUBLISH_ENABLED=false --project-ref gyooxmpyxncrezjiljrj
```

Rollback do frontend para o deployment anterior identificado:

```powershell
npx vercel rollback https://tvg-flow-qs1o0lwb6-tvg-multis-projects.vercel.app
```

Depois da migration, **não** reimplantar cegamente as versões antigas de `ap-render-engine`, `ap-render-recovery`, `ap-content-production` ou `ap-instagram-publisher`. Elas são incompatíveis com os invariantes e podem gerar falhas ou mentira de publicação. Manter as estruturas novas e aplicar forward fix.

Não executar `DROP`, down migration, delete de Storage, limpeza de gerações ou restauração total automática. O rollback P0 não requer restore do Storage: nenhum objeto antigo é alterado e objetos novos são append-only. Uma restauração física do banco exige decisão de incidente porque causa downtime e perde writes posteriores; ela não recupera bytes do Storage.

## 12. Registro de encerramento

Ao final da janela, registrar:

```text
RELEASE SHA:

SUPABASE MIGRATION VERSION:

FUNCTION VERSIONS:

FRONTEND DEPLOYMENT ID / URL:

BACKUP OBSERVED:

HISTORICAL posted_without_id BEFORE / AFTER:

PUBLISHER ENABLED:
NO

RENDER RECOVERY ENABLED:
NO

FIRST ORGANIC GENERATION VERIFIED:
YES / PENDING

ABORT CONDITION OBSERVED:
YES / NO

ROLLBACK OR CONTAINMENT USED:
YES / NO
```

O rollout P0 termina com publisher desligado. Homologação Instagram é uma fase posterior e não faz parte deste runbook.
