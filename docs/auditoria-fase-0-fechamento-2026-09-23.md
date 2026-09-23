# Fase 0 — Fechamento das Lacunas Técnicas Antes do Redesign UX

**Data:** 2026-09-23 · **Natureza:** 100% read-only, nenhuma mutação. Fecha só as 6 perguntas da Fase 0; nenhuma frente nova foi aberta.

---

## 1. Pipeline editorial real atual

Existem hoje, de fato, **dois pipelines coexistindo por desenho**, roteados por um feature flag **por tenant** (`ap.editorial_feature_flags.editorial_workflow_v1_enabled`, default `false` na ausência de linha — `supabase/migrations/20260902165214_r1_editorial_feature_flags.sql`). O roteamento é consistente nos três pontos de entrada que criam matéria a partir de uma pauta/texto manual — confirmado lendo o código, não suposto:

- `AutoPublisher.jsx` (Admin, criação manual): importa **ambos** `ArticleWizard` (legado) e `CanonicalArticleWizard` (novo) e alterna entre eles.
- `AutoPublisher.jsx` / `EmployeeMode.jsx` (Admin/Staff, adoção de pauta do Banco de Matérias): `if (creationMode === CANONICAL) startEditorialArticleFromBacklog(...) else <fluxo legado com ap-employee-generator>`.
- `MyNewsWork.jsx` (Admin/Staff, nova tela "Meu trabalho"): carrega sempre a lista legada (`ap.list_my_news_work`) e, só `if (editorialFlag.enabled)`, também a lista canônica (`listMyEditorialArticles` → `ap.list_my_editorial_articles`), mesclando as duas (`mergeLegacyAndEditorialWork`).

**Dado real de produção** (consultado via dump de dados, somente leitura): a tabela `ap.editorial_feature_flags` tem **2 linhas — uma por tenant existente — e AMBAS com `editorial_workflow_v1_enabled = true`** (atualizadas em 2026-09-18 e 2026-09-20). `editorial_ai_draft_enabled` é `true` só para um dos dois tenants. Ou seja: **na prática, hoje, para os dois tenants que existem em produção, o pipeline canônico já é o caminho ativo** para criação manual e adoção de pauta — não é mais "em rollout" no sentido de estar parcialmente ligado, está ligado para 100% da base real. A UI legada (`ArticleWizard`, `ap-employee-generator`) continua existindo no código como caminho B (para quando a flag está off), mas não está sendo exercitada por nenhum tenant real no momento.

| Entrada | Admin/Staff | Flag necessária | Pipeline usado hoje (tenants reais) | Fonte de verdade | Status |
|---|---|---|---|---|---|
| Manual ("Nova Matéria") | Ambos | `editorial_workflow_v1_enabled` | **Canônico** (`CanonicalArticleWizard` → `ap.start_editorial_article_direct` → `ap.editorial_articles`) | `ap.editorial_articles` | Ativo |
| Adoção de pauta (Banco de Matérias) | Ambos | `editorial_workflow_v1_enabled` | **Canônico** (`startEditorialArticleFromBacklog`) | `ap.editorial_articles` | Ativo |
| Rascunho por IA | Ambos, se disponível | `editorial_ai_draft_enabled` | `ap-editorial-ai-draft` (Anthropic real) | `ap.editorial_articles` (revisões) | Ativo só para 1 dos 2 tenants |
| Ingestão automática (RSS/Radar) | — (automático) | não verificado | **Legado** (`ap-data-ingestion` → `ap.candidate_news`, presumível — não reconfirmado nesta passada) | `ap.candidate_news` | **NÃO CONFIRMADO em detalhe** (ver observação) |
| Render final | — (automático) | — | `ap-editorial-render-dispatch` → funções `ap.p0_*` → `ap.candidate_news`/`ap.render_generations` | `ap.candidate_news` (render/publicação continuam nele) | Ativo |

**OBSERVAÇÃO FUTURA:** não reconfirmei nesta passada como o item entra no funil quando vem da ingestão automática (RSS/Radar) — o grep inicial em `ap-data-ingestion` não retornou `candidate_news`/`editorial_article` com o padrão usado; requer leitura direta do arquivo se isso importar para o redesign da tela de "Coletadas".

### Conclusão objetiva

**Opção C, já convergindo para A na prática**: existe uma arquitetura de rollout gradual por tenant (o flag e os dois caminhos continuam ambos no código — isso é real e é "transição" do ponto de vista da engenharia), mas **para efeitos de UX e do redesign**, os dois tenants reais de produção já estão 100% no pipeline canônico hoje. Recomendo que a próxima fase de redesign trate **`ap.editorial_articles` (via `editorialArticlesService.js`) como a fonte de verdade para autoria/revisão de conteúdo**, e `ap.candidate_news` como a fonte de verdade **apenas a partir do render em diante** (render, aprovação de geração, publicação) — o `ap-editorial-render-dispatch` é o ponto de handoff entre os dois mundos.

---

## 2. Notificações

**PARCIAL — bug real confirmado, mas mais específico do que a auditoria original descreveu.**

O código tem um comentário explícito confirmando que a separação é **intencional**, não um erro de nomenclatura: `notificacoes` (PT) = notificações de **reunião**; `notifications` (EN) = notificações de **tarefa**. Ambas são lidas e mescladas na mesma lista visual (`fetchNotifications`, realtime nas duas). O problema real:

| Evento | Cria em | Quem lê | Marca lida (`markAsRead`/`markAllAsRead`) | Remove (`clearNotification`/`clearAll`) |
|---|---|---|---|---|
| Reunião criada/lembrete | `notificacoes` (trigger SQL, `remote_schema.sql`) | Ambas as tabelas, mescladas | ✅ Escreve em `notificacoes` — funciona | ✅ Escreve em `notificacoes` — funciona |
| Tarefa atribuída/concluída | `create-os-by-function`, `complete-micro-task` → `notifications` | Ambas as tabelas, mescladas | ❌ Sempre escreve em `notificacoes`, mesmo para itens vindos de `notifications` | ❌ Idem |
| Devolução de etapa | `return-micro-task` → `notifications` | idem | ❌ idem | ❌ idem |
| Atraso de tarefa | `notify-overdue-tasks` → `notifications` | idem | ❌ idem | ❌ idem |
| Push | `send-push-notification` → lê `notifications` | — | — | — |

**O que acontece na prática**: clicar para marcar como lida ou limpar uma notificação de **tarefa** dispara um `UPDATE`/`DELETE` em `notificacoes` filtrando por um `id` que na verdade pertence a `notifications` — casa zero linhas, não dá erro, e o estado local (React) é atualizado de forma otimista. **Dentro da mesma sessão o usuário vê o efeito esperado** (some/marca como lida na tela). Mas a linha real em `notifications` nunca muda: `read_at` continua `NULL`, a linha nunca é apagada. **A cada novo carregamento da página/nova sessão, todas as notificações de tarefa "lidas"/"limpas" anteriormente voltam a aparecer como não lidas**, e a tabela `notifications` cresce indefinidamente sem nunca ser podada por essas ações. Além disso as duas tabelas têm esquemas de coluna diferentes para o mesmo conceito (`lida boolean` em `notificacoes` vs. `read_at timestamptz` em `notifications`), então a correção mínima não é só trocar o nome da tabela no código — é também tratar a coluna certa.

**Correção mínima futura** (não implementada): ao mesclar as duas listas, marcar cada notificação com sua tabela de origem (`_source: 'notificacoes' | 'notifications'`); `markAsRead`/`clearNotification`/`markAllAsRead`/`clearAll` decidem a tabela e a coluna (`lida` vs `read_at`) por esse marcador.

---

## 3. Conversão de OS × `tarefas_micro.funcao`

**BUG CONFIRMADO.**

`supabase/functions/converter-os-para-complexa/index.ts` (lido integralmente em `origin/main`) monta o insert assim:

```js
const microTasksToInsert = micro_tasks.map((mt, index) => ({
    tarefa_id: os_id,
    profissional_id: mt.profissional_id,
    descricao: mt.descricao,
    ordem: mt.ordem || index + 1,
    status: 'pendente'
}))
```

**Não há campo `funcao` em nenhum lugar da função** — nem no `ConvertRequest` recebido do frontend, nem no objeto inserido. O schema real de produção confirma `tarefas_micro.funcao` como `text NOT NULL`, **sem `DEFAULT`**. Verifiquei os 8 triggers existentes na tabela (`tr_enforce_tenant_tarefas_micro`, `trigger_set_micro_task_started_at`, etc.) — nenhum preenche `funcao` antes do insert. **Toda chamada a esta função deve falhar** no passo de `INSERT INTO tarefas_micro` com violação de `NOT NULL constraint`, sem exceção — não depende do input recebido.

Classificação: **BUG CONFIRMADO** (não "dependente do input" — falha sempre, incondicionalmente).

---

## 4. Migrations em produção ausentes do Git

Conteúdo real de cada uma, extraído da tabela de rastreamento de migrations do Supabase (`supabase_migrations.schema_migrations`, leitura direta, sem mutação):

| Migration produção | O que faz | Autor | Existe equivalente no Git? | Classificação |
|---|---|---|---|---|
| `20260920210432` | `reenable_ap_render_pipeline_cron_jobs` — 3 chamadas `cron.alter_job(job_id := 8/9/11, active := true)`. Puramente operacional (reativa jobs de cron do pipeline de render), zero DDL. | `djgeovanepanini@gmail.com` (aplicada manualmente pelo próprio usuário) | Não é uma mudança de schema, é uma ação operacional — não faz sentido ter "equivalente" em migration versionada | **C — mas de natureza operacional, não estrutural.** Recomendo registrar como runbook/nota, não como migration a recriar. Confirma, de passagem, que o pipeline de render usa `pg_cron` com pelo menos os jobs 8, 9 e 11. |
| `20260920222508` | `cleanup_tvgmulti_prontas_publicadas_backlog` — apaga dados de `candidate_news` (status aprovado/pending_review/posted) e poda `collected_news` a 1h, **escopado ao tenant `tvgmulti`**. Pura limpeza de dados operacional, zero DDL. | `djgeovanepanini@gmail.com` | N/A (é limpeza de dados, não estrutura) | **C — operacional.** Não é "código ausente do repo", é uma ação pontual de dados que naturalmente não pertence ao histórico de schema. |
| `20260920224143` | Corrige `claim_editorial_article_for_render()`: a função só devolvia `rev.headline`/`rev.body`, **descartando `rev.caption`** (a legenda real com hashtags gerada pela IA) — fazendo `ap-editorial-render-dispatch` cair num placeholder de legenda (o corpo do texto) e perder hashtags em toda matéria por esse caminho. `DROP + CREATE` (mudança de tipo de retorno). | (autor não capturado neste trecho) | **Provável duplicata/superseding de `20260920223000_fix_claim_editorial_article_missing_caption.sql`**, que existe em `origin/main` com nome quase idêntico e timestamp 17 minutos antes | **D — não foi possível reconstruir a relação exata sem diff completo dos dois arquivos.** É muito provável que seja o mesmo fix aplicado direto em produção e depois recommitado no Git sob outro timestamp (prática de hotfix-depois-formaliza), mas isso não foi confirmado byte-a-byte nesta passada — recomendo diff direto antes de mexer nessa função. |
| `20260922194425` | Infraestrutura de conexão Meta/Instagram: `CREATE TABLE ap.instagram_connections` (com enum de status `connected/disconnecting/disconnect_failed/disconnected/expired/error`) + tabelas `meta_authorizations`/`meta_oauth_states`/etc. Tokens nunca saem do Vault. | (autor não capturado) | Existe `20260921160000_meta_instagram_connection_infrastructure.sql` em `origin/main`, que **já cria as mesmas tabelas** (`ap.instagram_connections`, `ap.meta_authorizations`, etc.) — timestamp 1 dia antes | **D — mesma ressalva do item anterior.** Duas migrations para o mesmo conjunto de tabelas, uma no Git (dia 21) e uma só em produção (dia 22), é uma bandeira de reconciliação real — pode ser hotfix reaplicado, pode ser drift genuíno. **Requer diff textual completo dos dois arquivos antes de qualquer nova migration nessa área**, o que não fiz aqui por estar fora do escopo desta passada focada. |

**Risco de divergência**: baixo para as duas primeiras (puramente operacionais, sem DDL residual a reconciliar); **médio-alto para as duas últimas** (mesma área de schema com dois registros de migration possivelmente sobrepostos) — é o item mais concreto de dívida de processo encontrado nesta fase.

---

## 5. Publicação Meta/Instagram

Busquei no `origin/main` inteiro (`supabase/functions/`) qualquer chamada real à Graph API (`media_publish`, `graph.facebook.com`, `graph.instagram.com`) fora do worker legado já conhecido. Resultado: essas strings só aparecem em `_shared/metaOAuth.ts` (fluxo de autorização/descoberta de conta, não publicação) e em `ap-instagram-publisher/publicationWorkflow.mjs` (o worker legado, já confirmado desligado na Fase -1).

**PUBLICAÇÃO VIA META OAUTH AINDA NÃO IMPLEMENTADA/CONCLUÍDA.** A infraestrutura de conexão (`ap.instagram_connections`, `ap-meta-oauth-*`) existe e está deployada, mas nenhuma função usa o token de uma conexão conectada para efetivamente publicar. Encerrando o assunto conforme instruído — **isso não é bloqueador para o redesign de UX**.

---

## 6. Exclusão de OS

**SIM — o hard delete direto continua existindo e continua fazendo bypass de `excluir-os`.**

Confirmado lendo o handler real em `origin/main`:

- `src/pages/admin/Tasks.jsx`, `handleConfirmDelete()`: `supabase.from('tarefas').delete().eq('id', selectedTask.id)` — direto, sem Edge Function.
- `src/pages/staff/Tasks.jsx`: mesmo padrão (`.from('tarefas')` + `.delete()`).

A Edge Function `excluir-os` (soft-delete, `can_delete_os`, evento auditável) continua `ACTIVE` em produção (confirmado na Fase -1) mas não é chamada por nenhum dos dois arquivos.

**CORREÇÃO FUNCIONAL NECESSÁRIA ANTES OU DURANTE O REDESIGN DE TAREFAS.**

---

## 7. Pendências realmente necessárias (só confirmadas)

1. **`converter-os-para-complexa` falha sempre** — falta o campo `funcao` no insert (§3). Correção funcional pequena e isolada (1 arquivo, sem migration).
2. **Notificações de tarefa nunca são persistidas como lidas/removidas** entre sessões (§2). Correção pequena, frontend-only, mas precisa tratar 2 tabelas com colunas diferentes.
3. **Exclusão de OS ainda bypassa `excluir-os`** — perda de auditoria e arquivos órfãos continuam reais (§6).
4. **Duas migrations de Meta/Instagram potencialmente sobrepostas** (`20260921160000` no Git × `20260922194425` só em produção) precisam de diff/reconciliação antes de qualquer nova mudança nessa área de schema (§4).

Nenhuma dessas quatro pendências impede trabalhar na camada de UX/redesign — são todas backend/dados, isoladas, e não mudam o que a auditoria original já mapeou sobre navegação, telas e fluxos.

---

## 8. VEREDITO

### GO PARA REDESIGN UX

Nenhum dos achados desta fase describe um contrato de produto ainda desconhecido ou incerto o bastante para impedir o trabalho de experiência. As 4 pendências do item 7 são bugs backend pontuais e isolados (um deles nem chega a ser exercitado por usuário nenhum hoje, já que a criação de OS Workflow provavelmente já falha na prática antes mesmo da conversão). A publicação Instagram seguir pausada não é motivo de bloqueio, conforme já definido.

---

## 9. Fonte de verdade para a próxima fase

- **Pipeline a tratar como atual**: o **canônico** (`ap.editorial_articles` via `editorialArticlesService.js`) para autoria/revisão de matéria — é o que os dois tenants reais usam hoje. O pipeline legado (`ArticleWizard`, `ap-employee-generator` para criação direta) deve ser tratado como **caminho de fallback do flag**, não como caminho primário a desenhar.
- **Entidades/status fonte de verdade**:
  - Autoria/revisão de texto: `ap.editorial_articles` (status: `draft`, `editing`, `changes_requested`, `content_final`, `ready_for_render`, `dispatched`, `abandoned` — já mapeados para rótulos humanos em `editorialOperationalStage.js`, útil como ponto de partida para o vocabulário de UX).
  - Render/aprovação/publicação: continuam em `ap.candidate_news`, a partir do momento em que `ap-editorial-render-dispatch` faz o handoff.
- **Caminhos legados** (não desenhar como primários, mas não remover do código ainda): `ArticleWizard.jsx`/`ArticleForm.jsx` + `ap-employee-generator`/`ap-content-production` — continuam existindo por trás do flag, para o caso (hoje teórico) de algum tenant tê-lo desligado.
- **Partes ainda em construção, não prontas para o redesign assumir como existentes**: publicação automática via Meta OAuth (§5); reconciliação das 2 migrations de Meta/Instagram (§4).

---

## Confirmação final

```
git status
```
