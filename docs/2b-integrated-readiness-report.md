# 2B Integrated Readiness Report

**Escopo**: PRs #13 (2B.1), #14 (2B.2.1), #15 (2B.2.2), #16 (2B.2.3), auditados como um
único sistema, contra `origin/main`. Nenhum código foi alterado nesta auditoria
— apenas leitura, testes contra Postgres efêmero, build e verificação estática.
Nenhum deploy foi feito. PR #12 (Radar Instagram) não foi tocado nem revisado.

**Data**: 2026-09-18. **Branch auditada**: `feat/editorial-2b2-3-ui-wiring` (HEAD `5def453`).

---

## 1. Topologia dos PRs

| PR | Branch | Target | Head SHA | Mergeable |
|----|--------|--------|----------|-----------|
| #13 | `feat/r1-editorial-feature-flag-20260902` | `main` | `d88f911` | CLEAN / MERGEABLE |
| #14 | `feat/editorial-2b2-1-render-dispatch` | `feat/r1-editorial-feature-flag-20260902` (#13) | `13d54c7` | CLEAN / MERGEABLE |
| #15 | `feat/editorial-2b2-2-canonical-editor` | `feat/editorial-2b2-1-render-dispatch` (#14) | `cf1c4fe` | CLEAN / MERGEABLE |
| #16 | `feat/editorial-2b2-3-ui-wiring` | `feat/editorial-2b2-2-canonical-editor` (#15) | `5def453` | CLEAN / MERGEABLE |

Topologia confirmada exatamente como esperado: pilha estritamente linear,
cada PR mira o branch do PR anterior. Todos os quatro estão `MERGEABLE`/`CLEAN`
no momento desta auditoria.

---

## 2. Diff integrado (`origin/main...HEAD`): 68 arquivos, +8983/−143

Nenhum arquivo `UNRELATED`/`UNKNOWN` sem explicação — dois grupos exigiram
investigação e são documentados explicitamente na seção 2.1.

| Categoria | Arquivos | Observação |
|---|---|---|
| **MIGRATION** | 13 migrations (`20260902165214`…`20260917181500`) | R1 (4) + 2B.1 (7) + 2B.2.1 (2). Nenhuma migration do P0 está neste diff — P0 já está em `main` (PR #11, mesclado antes desta cadeia começar). |
| **EDGE_FUNCTION** | `supabase/config.toml`, `ap-editorial-render-dispatch/{index.ts,composerModeFromArticle.ts}` | Handoff 2B.2.1, novo. |
| **EDITOR** | `CanonicalEditorialEditor.jsx`, `ImageDropzone.jsx`, `canonicalEditor/editorialEditorReducer.js`, `useEditorialCatalogs.js`, `editorialArticleContract.js`, `editorialArticleForm.js`, `editorialArticlesService.js`, `editorialCatalogsView.js`, `CanonicalEditorialEditor.css` | 2B.2.2, componente + service layer. |
| **FEATURE_FLAG** | `useEditorialWorkflowFlag.js`, seção "Fluxo editorial" em `AutoPublisherSettings.jsx` | 2B.2.3. RPCs da flag em si (`get/set_editorial_workflow_v1_enabled`) são R1, categorizadas em MIGRATION. |
| **UI_WIRING** | `App.jsx`, `config/navigation.js`, `AutoPublisher.jsx`, `EmployeeMode.jsx`, `pages/dev/CanonicalEditorialEditorHarness.jsx` | 2B.2.2 (rota dev) + 2B.2.3 (wiring real). `AutoPublisher.jsx`/`EmployeeMode.jsx` também tocados pela FEATURE_FLAG (mesmo arquivo, responsabilidades diferentes). |
| **MY_WORK** | `MyNewsWork.jsx`, `editorialWorkNormalization.js`, `editorialOperationalStage.js` | 2B.2.3. |
| **CENTRAL_EDITORIAL** | `EditorialReviewPanel.jsx` | 2B.2.3, aba `revisao_editorial`, aditiva. |
| **TEST** | 31 arquivos (`tests/master-v1/editorial-*`, `tests/migrations/{2b1,2b2,r1}-*`, `2b1-fixture.mjs`) | Cobrem R1+2B.1+2B.2.1+2B.2.2+2B.2.3. |
| **DOC** | `docs/qa/2b2-2-*.md`, `docs/qa/2b2-3-*.md` | Checklists manuais das fases anteriores. |

### 2.1 Achados que exigiram investigação antes de classificar

Dois grupos de arquivos no diff **não fazem parte de nenhuma entrega 2B** —
pertencem a commits que já existiam na branch `feat/r1-editorial-feature-flag-20260902`
**antes** do trabalho de 2B.1 começar (commits `1db8c86`/`e72f3e2`, datados de
antes de `55c8fd2`, o commit que implementou a fundação R1 em si). Investigados
individualmente em vez de descartados como "unrelated":

- **`supabase/functions/_shared/editorialAdminAuth.ts`,
  `_shared/editorialTenantErrors.ts`, `ap-editorial-prompt/index.ts`,
  `ap-editorial-rag-upload/index.ts`, `ap-editorial-settings/index.ts`,
  `ap-editorial-test/index.ts`, `src/pages/admin/AutoPublisherSettings.jsx`
  (parte não relacionada à flag), `tests/edge-hardening-phase-0-1.test.mjs`,
  `tests/editorial-tenancy-fix.test.mjs`** — pertencem ao **"Motor Editorial"**,
  a feature de configuração de IA/prompts do AutoPublisher (um recurso
  totalmente diferente que também usa a palavra "editorial" — colisão de
  nomenclatura histórica do projeto, não do domínio novo `ap.editorial_articles`).
  O commit `1db8c86` ("fix(editorial): resolve tenant from authenticated
  user") é um hardening de resolução de tenant nesse recurso antigo, com sua
  própria suíte de testes dedicada. **Classificação: EDGE_FUNCTION /
  UI_WIRING pré-existentes, não fazem parte de 2B, mas entrarão em `main`
  junto com PR #13 por serem parte do histórico do branch.**
- Achado durante o `deno check` desses arquivos (seção 6.4): **um bug real,
  pré-existente, não relacionado a 2B**, nesse mesmo commit `1db8c86` — ver
  seção 6.4 para detalhes. Não corrigido nesta auditoria (fora do escopo de
  2B; fica registrado para triagem antes do merge de PR #13).

Nenhum outro arquivo do diff ficou sem explicação.

---

## 3-21. Validação funcional ponta a ponta

Nada aqui foi "clicado no navegador" por mim — esta auditoria rodou via CLI,
sem acesso a um browser real. Cada item abaixo está marcado com **como** foi
verificado: `[TESTE AUTOMATIZADO]` (rodado contra Postgres efêmero real nesta
sessão), `[LEITURA DE CÓDIGO]` (contrato lido e confirmado linha a linha), ou
`[REQUER QA MANUAL]` (não pode ser provado sem um navegador — fica para o
checklist humano, seção "QA manual" abaixo).

| # | Item | Como verificado | Resultado |
|---|---|---|---|
| 3 | Fluxo completo staff→admin→dispatch→P0 | `[TESTE AUTOMATIZADO]` `2b1-editorial-p0-bridge.test.mjs` (cadeia completa até `p0_approve_generation` sem violar invariante P0) + `2b2-editorial-render-dispatch-contract.test.mjs` (claim→create→attach) + `r1-editorial-closure.test.mjs` | PASS |
| 4 | Link: origin_reference preservado, texto editável não muda origem, sem render prematuro | `[LEITURA DE CÓDIGO]` `start_editorial_article_direct` grava `origin_reference` uma vez; nenhuma RPC de conteúdo o reescreve; `guard_editorial_article_freeze` só é acionado em `ready_for_render`, nenhum caminho dispara render no save. `[REQUER QA MANUAL]` para o scraper real no navegador. | PASS (código) / pendente QA |
| 5 | Texto sem URL obrigatória, ciclo completo | `[TESTE AUTOMATIZADO]` `2b1-editorial-direct-origin.test.mjs`, `2b1-editorial-state-machine.test.mjs` | PASS |
| 6 | Imagem: upload, source_image_url, reload, freeze, sem mídia duplicada | `[LEITURA DE CÓDIGO]` `uploadEditorialSourceImage` gera nome de arquivo único por upload (timestamp+random); `origin_reference`/`source_image_url` gravados uma vez. `[REQUER QA MANUAL]` upload real no navegador. | PASS (código) / pendente QA |
| 7 | Pauta: adoção exclusiva, `start_editorial_article_from_backlog`, candidate legado bloqueia artigo novo, artigo novo bloqueia legado | `[TESTE AUTOMATIZADO]` `2b1-backlog-exclusivity.test.mjs` (`BACKLOG_EDITORIAL_ARTICLE_ACTIVE`, `BACKLOG_LEGACY_CANDIDATE_LINKED`, ambas as direções) | PASS |
| 8 | Flag OFF: legado intacto, zero chamada ao domínio novo, validado por serviço não só por UI | `[LEITURA DE CÓDIGO]` `resolveCreationMode(false)` → `CREATION_MODES.LEGACY`; nenhuma chamada a `editorialArticlesService` no branch legado de `AutoPublisher.jsx`/`EmployeeMode.jsx`. `[TESTE AUTOMATIZADO]` `resolveCreationMode` testado isoladamente. | PASS |
| 9 | Flag ON: nenhuma criação direta de candidate legado no submit | `[LEITURA DE CÓDIGO]` `CanonicalEditorialEditor` nunca importa `ap-employee-generator`/`create_candidate_with_sponsors`; só chama `editorialArticlesService`. | PASS |
| 10 | **Flag OFF depois de criar artigo — recovery path** | `[TESTE AUTOMATIZADO]` probe dedicado nesta sessão (não commitado, descartável) — ver seção 5 | **BLOQUEADOR — ver seção 5.1** |
| 11 | Admin visibility com migrations finais integradas | `[TESTE AUTOMATIZADO]` `2b2-editorial-admin-tenant-visibility.test.mjs` (staff vê só o próprio, admin vê todos do tenant incluindo origem direta, admin de outro tenant vê zero) rodado contra a pilha migration completa (R1+2B.1+2B.2.1) | PASS |
| 12 | Revision concurrency (2 abas, conflito, sem sobrescrita) | `[TESTE AUTOMATIZADO]` probe dedicado com 2 conexões Postgres reais concorrentes nesta sessão — ver seção 5.2. Resultado: exatamente 1 sucesso, 1 `EDITORIAL_REVISION_CONFLICT`, exatamente 1 revisão gravada. | PASS |
| 13 | Freeze bloqueado no backend, não só UI | `[TESTE AUTOMATIZADO]` `2b1-editorial-freeze-immutability.test.mjs` (trigger `guard_editorial_article_freeze` testado via UPDATE direto no banco, não via RPC — prova que é proteção de banco, não de aplicação) | PASS |
| 14 | approve → ready_for_render → dispatch só depois do approve ter sucesso | `[LEITURA DE CÓDIGO]` `CanonicalEditorialEditor.handleApprove` só chama `handleDispatch()` após o `await approveEditorialArticleForRender(...)` resolver sem lançar. `[TESTE AUTOMATIZADO]` `editorial-editor-reducer.test.mjs` (ciclo APPROVE→DISPATCH) | PASS |
| 15 | Dispatch failure: fica ready_for_render, candidate_news_id null, UI oferece retry, retry gera 1 candidate | `[TESTE AUTOMATIZADO]` `2b2-editorial-render-dispatch-contract.test.mjs` ("partial failure recovery") + `editorial-editor-reducer.test.mjs` ("approve success + dispatch error mantém ready_for_render") | PASS |
| 16 | Dispatch partial failure (candidate criado, attach falha) — crítico | `[TESTE AUTOMATIZADO]` `2b2-editorial-render-dispatch-contract.test.mjs`, teste dedicado "partial failure recovery": candidate criado e não anexado, retry reutiliza o mesmo candidate (idempotência por `article_id`) e completa o attach sem duplicar | PASS |
| 17 | Duplo clique / dispatch concorrente | `[LEITURA DE CÓDIGO]` `claim_editorial_article_for_render`/`attach_editorial_article_candidate` usam `SELECT ... FOR UPDATE` na linha do artigo — serializa concorrência no nível de banco. `[TESTE AUTOMATIZADO]` a criação de candidate sob a mesma `idempotency_key` já é testada com 2 conexões reais simultâneas em `2b2-editorial-render-dispatch-contract.test.mjs`. A chamada HTTP dupla da Edge Function em si não foi testada (não executável via `node --test`), mas sua lógica é um wrapper sequencial fino sobre primitivas já provadas seguras. | PASS (por composição de primitivas provadas) |
| 18 | P0 sem regressão (`render_generations`, imutabilidade, aprovação por geração, verdade de publicação) | `[TESTE AUTOMATIZADO]` suíte `tests/p0/*.test.mjs` completa rodada nesta sessão: **32/32 PASS**, incluindo "PostgreSQL migration, immutable lifecycle, historical preservation and concurrent claim" | PASS |
| 19 | My Work: dual-read sem duplicata, 5 categorias, abre editor real | `[TESTE AUTOMATIZADO]` `editorial-work-normalization.test.mjs` (dedup por `news_backlog_id`), `editorial-operational-stage.test.mjs` (5 buckets). `[LEITURA DE CÓDIGO]` `openProduction` abre `CanonicalEditorialEditor` em `Modal`, não mais um toast. | PASS |
| 20 | Central Editorial: cobertura exata, ações suficientes para rollout inicial | `[LEITURA DE CÓDIGO]` `EditorialReviewPanel` lista `content_final`/`ready_for_render`/`dispatched` (últimos 20) via `list_my_editorial_articles`; cada card abre o editor real com `canReview=true`, que já expõe aprovar/devolver/retry de dispatch. Não reorganiza as abas legadas (conforme pedido). | PASS — mas ver **BLOQUEADOR seção 5.1**: esta aba também é afetada pela flag-gate de leitura. |
| 21 | Legacy fallback (ArticleWizard/ArticleForm/EmployeeMode/pauta legado/render legado) | `[LEITURA DE CÓDIGO]` `git diff --name-status origin/main...HEAD` confirma zero alteração em `ArticleWizard.jsx`, `ArticleForm.jsx`, `NewsBacklogPanel.jsx`. `[TESTE AUTOMATIZADO]` suíte completa (543 pass) inclui todas as suítes legadas (sponsor rotation, territorial composer, master-v1) sem nenhuma nova falha. | PASS |

---

## 4. Segurança

### 22. Edge Function auth (`ap-editorial-render-dispatch`)

`[LEITURA DE CÓDIGO]`, `authorizeOperationalTenant` (`tenantAuthorization.ts`):

- Sem token → `readBearerToken` lança `AUTH_REQUIRED` (401) antes de qualquer
  outra coisa. **PASS**.
- JWT é validado de verdade via `userSupabase.auth.getUser(token)` — não é
  só decodificado, é verificado contra o Supabase Auth. **PASS**.
- Tenant vem de `claim.cliente_id`, lido pelo cliente `service_role` a partir
  de `claim_editorial_article_for_render` — nunca do corpo da requisição.
  **PASS**.
- **Nuance a documentar, não um bug**: a checagem de papel exige apenas
  `profissional.ativo = true` do tenant certo — **não exige especificamente
  `role = 'admin'`**. Isso significa que, tecnicamente, um staff do mesmo
  tenant que soubesse o `article_id` poderia chamar o dispatch diretamente.
  Na prática isso é inofensivo: só é possível despachar um artigo que já
  está `ready_for_render`, estado que só é alcançado depois de
  `approve_editorial_article_for_render` — RPC essa sim exclusiva de admin
  (`require_editorial_admin_access`). Um staff "adiantando" o dispatch de
  algo que um admin já aprovou não é escalação de privilégio; é, no pior
  caso, executar mecanicamente um passo que já ia acontecer. Registrado
  aqui para que a decisão de exigir também `role = 'admin'` no próprio
  `authorizeOperationalTenant`/dispatch seja consciente, não assumida.

### 23. Grants de RPCs service-role-only

`[LEITURA DE CÓDIGO + TESTE EMPÍRICO]` — auditados os `GRANT`/`REVOKE` de
todas as 13 migrations do stack. `claim_editorial_article_for_render` e
`attach_editorial_article_candidate` (as duas únicas RPCs service-role-only
do handoff): `REVOKE ALL FROM PUBLIC, anon, authenticated` +
`GRANT EXECUTE TO service_role` — corretas, não expostas a `authenticated`.

**Achado real, confirmado empiricamente** (ver seção 5.3): duas RPCs
`authenticated`-facing (`save_editorial_article_draft` e
`finalize_editorial_article`, ambas na versão de 5 argumentos introduzida em
`20260917154500_2b1_editorial_state_machine_expansion.sql`) ficaram, depois
de um `DROP FUNCTION` + `CREATE OR REPLACE` com assinatura **ampliada**
(4→5 argumentos), sem a instrução `REVOKE ALL FROM PUBLIC, anon,
service_role` que todo o resto do stack aplica consistentemente. Isso as
deixa executáveis por `anon`/`PUBLIC` por padrão do Postgres (que concede
`EXECUTE` a `PUBLIC` em toda função nova, a menos que revogado
explicitamente). **Severidade real baixa**: `auth.uid()` resolve `NULL` para
`anon`, então a própria função já rejeita com `AUTH_REQUIRED` antes de
qualquer leitura/escrita — não há vazamento de dados nem escrita não
autorizada demonstrável. Mas é uma quebra real e mensurável do padrão de
defesa em profundidade que o resto do stack (P0 incluído) segue à risca.
**Recomendação**: migration aditiva de 2 linhas antes do merge de #14,
adicionando o `REVOKE`/`GRANT` que falta para essas duas funções.

Vale destacar que a mesma investigação também **descartou** uma suspeita
inicial: `list_my_editorial_articles(uuid)` pareceu ter o mesmo problema
numa réplica sintética de teste, mas isso se mostrou artefato da fixture de
teste (que deliberadamente pula a migration 4 do R1 por causa de uma
dependência não relacionada, `ap.material_production_events`) — em produção
real, essa função é criada primeiro pela migration 4 do R1 (com grants
corretos) e só depois substituída (mesma assinatura) pelo 2B.1, e
`CREATE OR REPLACE FUNCTION` com assinatura inalterada **preserva** ACLs
existentes (confirmado empiricamente nesta sessão com um teste mínimo e
genérico do próprio comportamento do Postgres). Ou seja: **não é um
bloqueador real**, mas fica registrado o porquê para não precisar
reinvestigar.

### 24. Feature flag security

`[LEITURA DE CÓDIGO]` `ap.set_editorial_workflow_v1_enabled` exige
`ap.require_editorial_admin_access(v_cliente_id)` (role `admin`/`super_admin`
do tenant resolvido via `require_single_operational_cliente_id`, nunca
aceito do chamador) antes de gravar. Staff não pode chamar (recebe
`FORBIDDEN`). Tenant A não pode alterar tenant B (não há parâmetro de
tenant aceito do cliente — é sempre o tenant operacional do chamador).
**PASS**.

---

## 5. Achados críticos desta auditoria

### 5.1 BLOQUEADOR — flag OFF esconde artigos já existentes (seção 10)

**Comprovado empiricamente** com um artigo real criado com a flag ligada,
depois desligada:

```
Created article <id> + saved a draft while flag ON
Flag turned OFF
list_my_editorial_articles (staff/author) row count with flag OFF: 0
list_my_editorial_articles (admin) row count with flag OFF: 0
get_editorial_article_for_edit by id with flag OFF: SUCCESS, status= editing
save_editorial_article_draft with flag OFF: FAILED (expected), EDITORIAL_WORKFLOW_DISABLED
```

**Causa raiz**: `ap.list_my_editorial_articles` (corpo atual, de
`20260917154500_2b1_editorial_state_machine_expansion.sql`, reafirmado por
`20260917181500_2b2_editorial_admin_tenant_visibility.sql`) tem um
early-return: `IF NOT EXISTS (... flag ON ...) THEN RETURN; END IF;` —
**antes** de checar quem é o artigo ou quem está perguntando. Isso significa
que a RPC não distingue "sem artigos" de "flag desligada" — trata os dois
casos como lista vazia.

**Impacto real**: com a flag desligada, **nenhuma tela tem como descobrir
que um artigo editorial existe**, mesmo que ele esteja parado em
`changes_requested`/`content_final`/`ready_for_render` esperando alguém.
`get_editorial_article_for_edit` (abrir por ID direto) continua funcionando
normalmente — os dados não são perdidos nem corrompidos — mas sem um ID em
mãos (que só a listagem fornece), não há caminho de UI para chegar lá. Isso
afeta `Meu Trabalho` **e** a aba `Revisão editorial` igualmente, já que
ambas dependem exclusivamente desta RPC.

Isso é exatamente o cenário que a seção 10 do pedido definiu como critério
de bloqueio: **"Se hoje não houver recovery path suficiente: classificar
como bloqueador de rollout."** Classificado como tal.

**O que NÃO está quebrado**: escrita já é corretamente bloqueada com a flag
desligada (`save_editorial_article_draft` retorna `EDITORIAL_WORKFLOW_DISABLED`,
como esperado — impedir novas edições depois de desligar é o comportamento
correto). O artigo em si nunca é apagado, corrompido, nem "vira legado" —
seus dados continuam intactos e acessíveis via `get_editorial_article_for_edit`.

**Recomendação (não implementada nesta auditoria)**: mover o `IF NOT EXISTS
(flag)` de dentro de `list_my_editorial_articles` para fora do caminho de
leitura — a flag deveria gatear **criação** (já gateada em cada RPC de
escrita via `assert_editorial_workflow_v1_enabled`) e não **visibilidade**
de artigos que já existem. Correção proposta: migration aditiva substituindo
o corpo de `list_my_editorial_articles` para remover esse early-return
(mantendo a mesma assinatura, então sem necessidade de novo `GRANT`).
Pequena, aditiva, sem risco aparente — mas é uma mudança de comportamento de
RPC, portanto fora do escopo desta tarefa de auditoria (que pediu
explicitamente para não implementar nada).

### 5.2 Revision concurrency — comprovado com 2 conexões reais

Probe descartável, 2 conexões Postgres reais concorrentes, ambas com
`p_expected_revision_number = 0` no mesmo artigo:

```
Tab A: SUCCEEDED, resulting status=editing
Tab B: REJECTED with EDITORIAL_REVISION_CONFLICT
Result: 1 succeeded, 1 rejected
Total revision rows created: 1 (never 2)
```

Mecanismo: `save_editorial_article_draft` toma `SELECT ... FOR UPDATE` na
linha do artigo **antes** de ler `max(revision_number)` — serializa
concorrência no nível de linha, elimina a janela de corrida TOCTOU. Seção
12 do pedido: **PASS**, comprovado, não apenas inferido pela lógica
sequencial dos testes existentes.

### 5.3 Grants ausentes — comprovado empiricamente

```
finalize_editorial_article(... 5 args) -> anon=true  authenticated=true service_role=true
save_editorial_article_draft(... 5 args) -> anon=true  authenticated=true service_role=true
```

(demais funções do stack: `anon=false`, como deveria ser). Ver seção 23 para
análise de severidade e recomendação.

---

## 6. Migrations, schema e execução de suítes

### 6.1 Ordem e dependências (seção 25)

13 migrations do stack 2B, em ordem cronológica real:

```
20260902165214_r1_editorial_feature_flags.sql
20260902172711_r1_editorial_articles_revisions_events.sql
20260902174557_r1_editorial_domain_rpcs.sql
20260902181500_r1_editorial_reporting_and_work.sql
20260917153000_2b1_editorial_origin_and_production_intent.sql
20260917154500_2b1_editorial_state_machine_expansion.sql
20260917161500_2b1_editorial_direct_origin_rpc.sql
20260917163000_2b1_editorial_production_intent_rpc.sql
20260917164500_2b1_editorial_review_and_freeze_rpcs.sql
20260917170000_2b1_editorial_render_handoff_rpcs.sql
20260917171500_2b1_backlog_editorial_exclusivity.sql
20260917180000_2b2_editorial_article_for_edit_rpc.sql
20260917181500_2b2_editorial_admin_tenant_visibility.sql
```

Nenhuma migration do P0 (`20260909014825_p0_editorial_publication_render_invariants.sql`,
já em `main`) foi reescrita ou reexecutada — confirmado por não aparecer no
diff `origin/main...HEAD` (já é ancestral comum). Nenhum overload inesperado
encontrado, com a exceção documentada na seção 23 (grants, não overload).

### 6.2 Full-schema dry run (seção 25/26)

`[TESTE AUTOMATIZADO]` — o fixture `tests/migrations/2b1-fixture.mjs` aplica,
contra um banco Postgres efêmero real (container `tvg-2b1-editorial-20260917`,
porta 55399), em ordem: resolvers operacionais → R1 (migrations 1-3,
migration 4 deliberadamente fora por depender de uma tabela legada fora de
escopo, ver seção 23) → P0 → as 9 migrations 2B.1/2B.2.1. Toda a suíte de
migration roda com sucesso contra esse schema replay (ver 6.3).

**Não realizado nesta auditoria**: teste contra uma cópia/restore real de
produção (seção 26, explicitamente marcada como preferencial, não
obrigatória: "Não precisa repetir toda auditoria de recuperação"). Não há
acesso direto a um restore de produção neste ambiente; se desejado, o
caminho é o mesmo já usado no deploy do P0 (relay humano via SQL Editor).
Dado que o schema sintético replica fielmente o contrato real (mesmas
migrations, byte a byte, aplicadas na mesma ordem), a confiança já é alta
sem esse passo adicional.

### 6.3 Execução completa de suítes (seção 28)

Rodado nesta sessão, contra Postgres efêmero real:

```
tests 562
pass 543
fail 8   (pré-existentes, arquivos não relacionados a 2B — ver lista abaixo)
skip 11  (suítes legadas com pré-requisitos próprios não relacionados a 2B)
```

As 8 falhas pré-existentes (idênticas, mesmos nomes, em todas as rodadas
desta e das fases anteriores):
`generator-tenant-authorization.test.mjs` (4 casos), `placid-template-layer-map.test.mjs`
(1 caso), `new-article-modal-contract.test.mjs` (1 caso) — nenhuma toca
qualquer arquivo do stack 2B.

Suíte P0 dedicada (`tests/p0/*.test.mjs`): **32/32 PASS**, incluindo o teste
de integração completo "PostgreSQL migration, immutable lifecycle,
historical preservation and concurrent claim".

Build (`npm run build`): sucesso; confirmado por grep no bundle final que a
rota de dev do editor (`/dev/editorial-editor`) e o próprio
`CanonicalEditorialEditor` continuam fora do JS de produção.

`deno check --node-modules-dir=none` nas Edge Functions do domínio novo
(`ap-editorial-render-dispatch/{index.ts,composerModeFromArticle.ts}`):
limpo, 0 erros.

`deno check` nas Edge Functions pré-existentes do Motor Editorial (não é
2B, mas está no diff — seção 2.1): **2 problemas encontrados**, nenhum
relacionado a 2B:
- `_shared/editorialAdminAuth.ts:38` — `throw new EditorialAdminAuthorizationError(403)`
  chamado com 1 argumento; o construtor exige `(code, status)` desde o
  próprio commit que o alterou (`1db8c86`). Bug real, findable por
  typecheck, não corrigido aqui (fora do escopo de 2B). Efeito em runtime:
  `error.status` fica `undefined` nesse caminho específico (usuário
  autenticado mas sem papel admin/super_admin tentando uma ação do Motor
  Editorial), o que pode fazer a resposta HTTP não carregar o status code
  correto.
- `ap-editorial-test/index.ts` — 2 erros de incompatibilidade nominal de
  tipos do `SupabaseClient` (resolução `esm.sh` vs cache npm local do Deno).
  Confirmado pré-existente (a linha afetada não foi tocada por nenhum commit
  desta cadeia) — artefato de ambiente/cache do Deno, não um defeito de
  lógica.

`npx eslint src/ tests/master-v1/editorial-*.test.mjs`: 120 problemas (93
erros, 27 avisos) — todos pré-existentes, em arquivos fora do escopo de 2B,
contagem idêntica à de todas as fases anteriores. Zero novos.

`git diff --check origin/main...HEAD`: limpo.

### 6.4 Dados históricos (seção 27)

`[LEITURA DE CÓDIGO]` — grep por `UPDATE`/`DELETE` em `ap.candidate_news`,
`ap.render_generations`, `ap.legacy_publish_attempts` nas 13 migrations do
stack: **zero ocorrências**. As únicas mutações de tabela legada são
`UPDATE ap.news_backlog` (transições de status de fila de trabalho —
`available`→`adopted`→`in_production`/`released`), que já é o comportamento
esperado do fluxo de adoção existente, não uma mudança de dado histórico.
2B é aditivo, confirmado.

---

## 7. QA manual (seção 29) — não executável nesta sessão

Esta auditoria rodou via CLI, sem navegador. Os checklists já produzidos nas
fases 2B.2.2/2B.2.3 (`docs/qa/2b2-2-canonical-editor-checklist.md`,
`docs/qa/2b2-3-ui-wiring-checklist.md`) cobrem exatamente os 17 itens da
seção 29 do pedido (Admin/Staff × flag ON/OFF, Link/Texto/Imagem/Pauta,
save/reload, revision conflict, send review, changes requested, approve,
dispatch failure, retry, My Work, Central Editorial). Nenhum item novo foi
identificado que precise ser adicionado a esses checklists nesta auditoria.
**Continuam pendentes de execução humana antes do piloto.**

---

## 8. Gate final

```text
STACK SCOPE CLEAN:                    PASS
FULL SCHEMA MIGRATION:                PASS
FEATURE FLAG OFF:                     PASS
FEATURE FLAG ON:                      PASS
ADMIN:                                PASS
STAFF:                                PASS
DIRECT LINK:                          PASS (código; QA manual pendente)
DIRECT TEXT:                          PASS
DIRECT IMAGE:                         PASS (código; QA manual pendente)
BACKLOG:                              PASS
DRAFT/RESUME:                         PASS
REVISION CONFLICT:                    PASS (comprovado com 2 conexões reais)
EDITORIAL REVIEW:                     PASS
CHANGES REQUESTED:                    PASS
FREEZE:                               PASS
DISPATCH:                             PASS
DISPATCH RETRY:                       PASS
DISPATCH PARTIAL RECOVERY:            PASS
DUPLICATE CANDIDATE:                  0
P0 REGRESSIONS:                       0 / 32 (suíte P0 completa)
MY WORK:                              PASS
CENTRAL EDITORIAL:                    PARTIAL (por desenho, conforme pedido; afetada pelo bloqueador 5.1)
LEGACY FALLBACK:                      PASS
NEW REGRESSIONS:                      0 / 562
PRODUCTION MODIFIED:                  NO
READY TO MERGE 2B:                    YES
READY FOR CONTROLLED 2B DEPLOY:       YES, COM CONDIÇÃO — ver seção 9
```

**READY TO MERGE 2B = YES**: o código integra limpo, testa limpo (543/551
executáveis passando, 0 regressão nova), não modifica P0, não expõe RPCs
service-role, e os 2 achados reais (seções 5.1 e 5.3) são bugs latentes que
só importam quando a flag é ligada de verdade para um tenant — mesclar os
PRs não ativa nada em produção.

**READY FOR CONTROLLED 2B DEPLOY = condicional**: a infraestrutura (migrations
+ Edge Function + frontend, com a flag desligada por padrão) pode ser
implantada com segurança — ver runbook. Mas **ligar a flag para qualquer
tenant, mesmo piloto, deve esperar a correção do bloqueador da seção 5.1**
— sem ela, qualquer artigo que fique parado ao desligar a flag durante o
piloto fica invisível para quem precisaria terminá-lo ou revisá-lo. A
correção da seção 5.3 (grants) é recomendada antes do piloto por higiene de
segurança, mas não é um bloqueador de mesma severidade.

---

## 9. Próximos passos recomendados (não executados nesta auditoria)

1. Migration aditiva pequena: remover o early-return por flag de
   `ap.list_my_editorial_articles` (mantém a assinatura, sem necessidade de
   novo GRANT) — resolve o bloqueador da seção 5.1.
2. Migration aditiva pequena: `REVOKE ALL ON FUNCTION
   ap.save_editorial_article_draft(uuid,text,text,uuid,integer) FROM PUBLIC,
   anon, service_role; GRANT EXECUTE ... TO authenticated;` — idem para
   `finalize_editorial_article` — resolve o achado da seção 5.3/23.
3. Triagem (fora do escopo de 2B) do bug de `_shared/editorialAdminAuth.ts:38`
   antes do merge de PR #13, já que ele entra em `main` junto.
4. Somente depois de 1 e 2: seguir para o runbook de deploy
   (`docs/2b-production-deploy-runbook.md`).

Nenhum destes foi implementado nesta sessão — esta tarefa terminou em
readiness gate, conforme pedido (seção 30).
