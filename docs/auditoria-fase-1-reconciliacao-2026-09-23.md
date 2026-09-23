# Fase -1 — Reconciliação da Auditoria de UX com o Estado Real de Produção

**Data:** 2026-09-23
**Natureza:** 100% read-only. Nenhum código, migration, dado ou configuração foi alterado. Nenhuma função com efeito mutável foi invocada (nem `ap-scheduler`, `ap-instagram-publisher`, RPCs de negócio, deploys, ou publicação).
**Motivação:** a auditoria anterior (`docs/auditoria-ux-ia-autopublisher-2026-09-23.md`) foi feita lendo o código da branch local `fix/autopublisher-legacy-modal-ui`. Esta fase existe para verificar se aquele código ainda representa a realidade — do `origin/main` e do Supabase de produção.

---

## A. Baseline Real Atual

| Item | Valor |
|---|---|
| Branch local | `fix/autopublisher-legacy-modal-ui` |
| HEAD local | `c981b1e46be3a4dedae0363e47a42c9e90cae8f8` |
| `origin/main` (HEAD real) | `b1557ad2126280917b61365d46994297129015ff` |
| Divergência | **A branch auditada está 150 commits atrás de `origin/main`** (`git log HEAD..origin/main` lista 150 commits; `git log origin/main..HEAD` está vazio — ou seja, a branch auditada não tem nenhum commit que `origin/main` não tenha, é puramente uma cauda antiga) |
| Projeto Supabase de produção | **`gyooxmpyxncrezjiljrj`** ("TVG - Flow", org `tbqitxbibxqcqtvtpvks`), confirmado via `.env.local` (`VITE_SUPABASE_PROJECT_ID`) e via `supabase projects list` (linkado localmente, marcado ●) |
| Acesso MCP Supabase desta sessão | **Não alcança o projeto de produção real.** O conector MCP `claude_ai_Supabase` só lista dois projetos não relacionados ("CityOS - Oficial", "S.I.G.O"). Toda a verificação de banco desta fase foi feita via **Supabase CLI local** (`npx supabase`, já autenticado e linkado ao projeto correto) e via `gh` (GitHub CLI, autenticado), não via MCP. |
| Working tree | Limpo, idêntico ao início da fase anterior — apenas o arquivo novo `docs/auditoria-ux-ia-autopublisher-2026-09-23.md` (não rastreado). Nenhuma alteração feita. |
| Deploy de produção identificável | Edge Functions com timestamps de atualização reais via `supabase functions list` (ver seção E) — várias atualizadas em **2026-09-20** e **2026-09-22** (1 a 3 dias antes desta auditoria). Não foi possível confirmar o pipeline de CI/CD exato que publica essas versões (ver limitações abaixo). |
| Workflow de GitHub Actions encontrado | `.github/workflows/process-notifications.yml` — **desabilitado por inatividade** (`disabled_inactivity`), últimas execuções em 2026-07-05. A função `process-notifications` que ele chamava foi removida da produção (confirmado — não consta em `supabase functions list`). |

**Limitação registrada:** não encontrei um workflow de GitHub Actions que faça deploy de Edge Functions ou do frontend (Vercel) para produção — o único workflow do repositório é o de notificações, já desativado. O deploy de Edge Functions provavelmente acontece via `supabase functions deploy` manual ou via integração Vercel↔Supabase fora do GitHub Actions — **NÃO CONFIRMADO** qual é o pipeline exato. Isso não impede as conclusões abaixo (que comparam código-fonte do `origin/main` contra o que está de fato ativo/deployado, verificado independentemente), mas significa que não posso garantir que todo commit em `origin/main` está automaticamente em produção — verifiquei deployment real function-a-função onde importava.

---

## B. O Que Mudou Desde a Auditoria (commits e migrations relevantes)

A branch auditada carecia de ~150 commits. Os mais relevantes para os achados da auditoria:

- **Linha "editorial AI / canonical" (nova, ~20 commits)**: `feat(editorial): implement R1 editorial domain foundation`, `feat: add canonical editorial AI drafts`, `feat: add canonical pre-render editor component`, `feat: add render dispatch handoff for reviewed articles`, `fix: enforce Anthropic editorial draft schema`, `fix: stabilize Anthropic draft and scraped image`, `feat: prepare collected news with editorial AI` — um pipeline de geração de rascunho editorial via IA (Anthropic) inteiramente novo, com migrations dedicadas (`20260902165214_r1_editorial_feature_flags.sql` até `20260923190000_sign_editorial_article_by_producer.sql`, 30+ migrations).
- **Linha "Meta/Instagram" (nova)**: `feat(radar): add Instagram ingestion provider foundation`, `checkpoint: meta instagram connection infrastructure`, `fix: close meta oauth epoch and vault races`, migration `20260921160000_meta_instagram_connection_infrastructure.sql` — infraestrutura de conexão OAuth real com Meta/Instagram, com 6 Edge Functions novas (`ap-meta-*`), **deployadas em 2026-09-22, um dia antes desta auditoria**.
- **`security: contain production P0 surfaces` / `security: close anonymous exposed surfaces`** — hardening de segurança, coincide com a migration `20260909014825_p0_editorial_publication_render_invariants.sql` que introduziu as funções `ap.p0_*` (ver seção D).
- **`fix: use cas lock for image fetcher`, `feat(autopublisher): add territorial composition workflow`** — já presentes na branch auditada em parte, mas evoluídos.
- **`ab80c19 fix(autopublisher): fix phantom empty grid columns in tab bar`, `9bb09ff fix(autopublisher): simplify review pipeline, newest-first ordering`, `120361c feat(autopublisher): simplify editorial workspace UX`** — mudanças de UX no próprio AutoPublisher já em andamento, na mesma direção da auditoria (simplificação).
- **4 migrations aplicadas à produção que não existem nem em `origin/main`**: `20260920210432`, `20260920222508`, `20260920224143`, `20260922194425` — aplicadas diretamente ao banco (via dashboard ou CLI) sem passar por commit no repositório. Isso é uma confirmação adicional, mais grave, da issue #5 ("schema não reproduzível") — não é só a branch auditada que estava desatualizada, é o próprio `origin/main` que está um pouco atrás do banco real.

---

## C. Bugs Críticos Realmente Existentes em Produção (confirmados)

Dos 4 bugs críticos da auditoria anterior, **nenhum se confirma no estado atual real** (todos já corrigidos antes desta auditoria ter sido escrita) — ver seção D para o detalhamento de cada um.

**Achados novos, não listados na auditoria anterior, que merecem atenção:**

1. **O worker de publicação automática no Instagram (`ap-instagram-publisher`) está desligado por design em produção.** O código (`origin/main`) checa `Deno.env.get("AP_LEGACY_PUBLISH_ENABLED") !== "true"` e retorna `{disabled: true}` se a variável não estiver setada — e `AP_LEGACY_PUBLISH_ENABLED` **não aparece** em `supabase secrets list` (verificado, lista de 19 secrets reais da produção, sem essa chave). Além disso `INSTAGRAM_ACCESS_TOKEN` e `INSTAGRAM_BUSINESS_ACCOUNT_ID` (também lidos pelo código) **também não existem** nos secrets. Ou seja: mesmo que alguém reativasse a flag, faltariam as credenciais estáticas. Isso não é um bug — é uma decisão deliberada e bem sinalizada: o próprio `AutoPublisher.jsx` do `origin/main` exibe ao operador a mensagem **"Publicar pelo sistema está temporariamente indisponível. Baixar a arte não confirma envio ao Instagram."** (linha ~1652). O botão que fazia `UPDATE status='posted'` sem publicar de fato **foi removido** — não existe mais `handlePublish` nem literal `status: 'posted'` no arquivo atual.
2. **Nova infraestrutura de conexão Meta/Instagram via OAuth foi deployada 1-3 dias antes desta auditoria** (`ap-meta-oauth-start` v2, `ap-meta-connection-status` v2, `ap-meta-oauth-select`/`ap-meta-disconnect`/`ap-meta-oauth-callback`/`ap-meta-deauthorize` v1, todos `updated_at` em 2026-09-22) — claramente um trabalho em andamento para substituir o "legacy" por conexão real por tenant. **NÃO CONFIRMADO** se essa nova via já publica de fato (não encontrei uma Edge Function que complete a publicação usando o token OAuth conectado — só a infraestrutura de conexão/autorização). Recomendo tratar isso como feature em construção, não como caminho de publicação já operacional.

---

## D. Achados Invalidados (a auditoria antiga concluiu, mas não corresponde mais à produção)

| # | Achado original | Situação real hoje | Evidência |
|---|---|---|---|
| 1 | "Solicitar Ajuste" quebrado (`return-micro-task` vs `return-micro-tasks`) | **INVALIDADO — corrigido.** Produção só tem `return-micro-task` (singular) deployado (`ACTIVE`, v16, atualizado 2026-09-18). A função plural não existe mais. O nome do Edge Function foi alinhado ao que o frontend sempre chamou. | `supabase functions list --project-ref gyooxmpyxncrezjiljrj`; diffstat mostra `return-micro-tasks/index.ts` deletado (146 linhas) e `return-micro-task/index.ts` criado (118 linhas) em `origin/main` |
| 2 | RPC `ap.discard_news_backlog_item` não existe | **INVALIDADO — existe desde 2026-08-24**, quase um mês antes desta auditoria. Migration `20260824000000_add_discard_news_backlog_item.sql`, aplicada e confirmada no dump real do schema de produção: `CREATE OR REPLACE FUNCTION "ap"."discard_news_backlog_item"(...)`, com `GRANT ... TO "authenticated"` e comentário descrevendo a regra de negócio real ("Archives an unclaimed or self-adopted backlog item..."). | dump de schema real (`supabase db dump --linked`), linha 4266+ |
| 3 | Publicação no Instagram é manual e "mentirosa" (botão só faz `UPDATE status='posted'`) | **INVALIDADO na forma original.** Esse botão/handler não existe mais no `origin/main`. Existe agora um pipeline real de claim-and-confirm no banco (`ap.p0_list_publish_candidates` → `ap.p0_claim_publication` → `ap.p0_finish_publication`, este último exige `external_media_id` numérico real vindo de uma tentativa confirmada — não aceita valores arbitrários) e um worker (`ap-instagram-publisher`) que o orquestra. **Porém** esse worker está desligado (ver seção C) — então hoje **não existe nenhum caminho, nem falso nem automático, publicando de fato**; a UI é honesta sobre isso. Reclassificar de "bug crítico" para "feature pausada/em construção, comunicada corretamente ao usuário". | leitura de `origin/main:supabase/functions/ap-instagram-publisher/index.ts`, `origin/main:src/pages/admin/AutoPublisher.jsx` (linha 1652), dump de schema (funções `p0_*`), `supabase secrets list` |
| 4 | Nenhum LLM roda no caminho de produção de conteúdo | **PROVAVELMENTE INVALIDADO, com ressalva de escopo.** Existe uma Edge Function `ap-editorial-ai-draft` (ACTIVE, v20, deployada e atualizada 2026-09-20) que chama a API real da Anthropic (`Deno.env.get("ANTHROPIC_API_KEY")`, e essa chave **está presente** em `supabase secrets list`), e ela é invocada a partir de `src/services/editorialArticlesService.js` — um serviço de produção, não um harness de dev. Isso é evidência forte de que existe hoje um caminho real de geração de texto por IA. **Ressalva**: não confirmei se esse novo pipeline "R1/canonical editorial" já é o caminho *padrão* para todo operador ou se ainda está atrás de um rollout gradual — os nomes dos commits ("gate canonical creation on resolved editorial flag", "wire canonical editor into admin and staff flows **behind flag**") sugerem um flag de rollout. Marcar como **PARCIAL**: a capacidade existe e está credenciada/conectada de verdade (diferente do achado de publicação, que carece de credenciais), mas o alcance exato (todo tenant? só alguns?) não foi confirmado nesta passada. | `git show origin/main:supabase/functions/ap-editorial-ai-draft/index.ts`; `git grep ap-editorial-ai-draft origin/main -- src/` aponta para `editorialArticlesService.js`; `supabase secrets list` mostra `ANTHROPIC_API_KEY` |

---

## E. Divergências Código × Banco × Deployment

| Camada | Achado |
|---|---|
| Branch auditada vs. `origin/main` | 150 commits de atraso — praticamente todo o trabalho recente de AutoPublisher (IA editorial, Meta OAuth, simplificação de UX, segurança) não estava presente no código lido pela auditoria original. |
| `origin/main` vs. banco de produção | 4 migrations aplicadas à produção não existem em `origin/main` (`20260920210432`, `20260920222508`, `20260920224143`, `20260922194425`) — confirma que a issue #5 (schema não reproduzível) **ainda é real hoje**, mesmo comparando com o código mais atual do repositório, não só com a branch antiga. |
| Edge Functions no repo vs. deployadas | Em geral alinhadas — toda função presente em `origin/main/supabase/functions/` que eu testei aparece com status `ACTIVE` em produção, e as que foram deletadas do repo (`ap-scheduler`, `ap-send-to-studio`, `ap-feed-composer`, `ap-learning-engine`, `create-microtasks`, `scheduler-deadline-notifications`, `process-notifications`, `diagnostic-tool`, `test-db`, `get_super_admin_dashboard_stats`) **não aparecem mais** na lista de funções deployadas — ou seja, a limpeza de código morto identificada no `origin/main` já foi para produção também. Não identifiquei nenhuma função órfã deployada que não exista mais no repo. |
| Secrets configurados vs. código que os espera | Gap real encontrado: `ap-instagram-publisher` espera `AP_LEGACY_PUBLISH_ENABLED`, `INSTAGRAM_ACCESS_TOKEN`, `INSTAGRAM_BUSINESS_ACCOUNT_ID` — nenhum dos três está configurado. Isso é a causa raiz de o worker estar inoperante (ver seção C), não um bug de código. |
| GitHub Actions vs. o que realmente roda | O único workflow do repositório está desabilitado; a função que ele chamava foi removida. O mecanismo real de disparo periódico das Edge Functions (cron do Postgres via `pg_cron`, provavelmente) **não pôde ser inspecionado** nesta sessão — tentativa de `supabase db dump --linked -s cron` retornou um dump vazio de conteúdo (só o cabeçalho padrão do `pg_dump`), sugerindo que o schema `cron` não é acessível com a role usada pela CLI, ou não há jobs cadastrados nela visíveis a essa role. **NÃO CONFIRMADO** quais Edge Functions têm cron ativo hoje. |

---

## F. Contrato Real do AutoPublisher Atual (do input até publicação/permalink)

Com base no `origin/main` (não na branch antiga):

1. **Entrada**: ingestão automática (`ap-data-ingestion`, reescrito — diff de 409 linhas), manual Admin/Staff, e Banco de Matérias — estrutura de entrada não mudou de forma que invalide o mapeamento da auditoria original, mas `ap-data-ingestion` e `ap-image-fetcher` tiveram reescritas grandes (409 e 320 linhas de diff) que **não foram reauditadas em detalhe** nesta fase — tratar o fluxo de ingestão automática/scoring como **NÃO CONFIRMADO** em detalhe, apenas confirmado que as funções continuam ativas e deployadas.
2. **Produção de conteúdo**: agora existe um caminho editorial "canônico" adicional (`ap-editorial-ai-draft` → gera rascunho via Anthropic; `ap-editorial-render-dispatch`, 501 linhas, novo, ACTIVE, atualizado 2026-09-22 — despacha para render) que coexiste com o caminho antigo (`ap-employee-generator` → `ap-content-production`, ainda ACTIVE). A relação exata entre os dois caminhos (o antigo foi substituído, ou os dois coexistem para tipos de conteúdo diferentes?) **não foi determinada nesta fase** — é o principal ponto que uma Fase 0/1 de correção deveria esclarecer antes de mexer em UI, porque implica em qual serviço realmente representa "a" fonte de verdade do conteúdo hoje.
3. **Render**: pipeline `p0_begin_render` → `p0_complete_render`/`p0_fail_render`, com `render_generations` como tabela de tentativas (novo — mais robusto que o `render_url`/`error_log` direto na `candidate_news` que a auditoria original descreveu). `p0_complete_render` valida que a URL do asset é imutável e pertence ao bucket `ap-renders` — hardening real contra adulteração.
4. **Revisão/Aprovação**: novo status `changes_requested` existe no CHECK constraint real (`ADD CONSTRAINT candidate_news_status_check ... OR status = 'changes_requested'`), com um campo `correction_draft` associado — sugere que agora existe um ciclo real de "pedir alteração" que a auditoria original não encontrou (ela descreveu revisão como só "aprovar" ou "rejeitar", sem meio-termo). **NÃO CONFIRMADO em detalhe** como esse ciclo funciona na UI — recomendo mapear na Fase 0.
5. **Publicação**: pipeline de claim-and-confirm real existe no banco (`p0_list_publish_candidates`/`p0_claim_publication`/`p0_finish_publication`), mas o único worker que o aciona (`ap-instagram-publisher`) está desligado por falta de secret + credenciais (seção C). A UI comunica isso honestamente. **Conclusão prática igual à da auditoria original** (publicação real acontece fora do sistema hoje), mas por um motivo muito diferente e muito menos grave: não é uma mentira silenciosa, é uma feature pausada e sinalizada.
6. **Permalink/Histórico**: `instagram_post_id` continua existindo e sendo a fonte do link — inalterado estruturalmente.
7. **`AutoPublisherMonitoring.jsx`**: **confirmado que continua órfão** — nenhuma rota ou item de menu foi adicionado em `origin/main` (diff de `App.jsx` e `navigation.js` não inclui essa página). Achado original permanece válido.

---

## G. Contrato Real de Tarefas Atual (da criação até conclusão/histórico)

- **`priority`/`prioridade` (tarefas)**: **confirmado no schema real de produção** — ambas as colunas existem, ambas `NOT NULL`, com defaults diferentes (`priority` default `'medium'`, `prioridade` default `'normal'` via enum `prioridade_tarefa`). A duplicidade é real, atual, e não foi resolvida. Achado original **permanece válido**.
- **`tarefas_micro.funcao`**: **confirmado `NOT NULL`** no schema real (sem default). O `converter-os-para-complexa/index.ts` em `origin/main` foi modificado (diff de 20 linhas) e agora popula explicitamente `descricao` e `ordem` no insert — uma evolução em relação à auditoria original. **Não consegui confirmar se `funcao` também passou a ser preenchido** (a busca por esse termo específico no arquivo não retornou nenhuma ocorrência) — este ponto fica como **NÃO CONFIRMADO**, recomendo reverificação direta do `INSERT INTO tarefas_micro` completo antes de tratar esse achado como resolvido ou não.
- **`empresa_profissionais.cargo`**: **a coluna existe** no schema real de produção (`"cargo" "text"`), contrariando a suspeita da auditoria original (baseada num comentário do código antigo) de que ela teria sido removida. Isso **reduz a severidade** daquele achado — a criação de OS em modo Workflow provavelmente não falha por esse motivo específico. Não fiz um teste funcional completo (não posso, seria mutação), então mantenho como "achado original enfraquecido, não mais como provável causa de falha".
- **`notificacoes`/`notifications`**: ambas as tabelas **confirmadas existentes** no schema real. `NotificationCenter.jsx` **não foi alterado** entre a branch auditada e `origin/main` (zero diff) — forte indício de que o comportamento descrito na auditoria original (lê das duas, escreve só na tabela PT, enquanto o domínio de tarefas grava na EN) **continua válido hoje**, mas não confirmei função por função quem escreve onde nesta passada — reverificação direta recomendada antes de corrigir.
- **`excluir-os` vs. hard delete direto**: a função `excluir-os` continua `ACTIVE` em produção. O único diff em `src/pages/admin/Tasks.jsx` entre as duas branches é puramente de classes CSS (nomes de classe adicionados aos modais) — **nenhuma mudança de lógica**. Achado original (exclusão bypassa a Edge Function auditável) **permanece válido com alta confiança**, já que o arquivo que continha essa lógica não mudou de forma relevante.
- **3 tabelas de histórico (`os_eventos`, `logs_tarefas`, `tarefas_micro_logs`)**: todas **confirmadas existentes** no schema real. Não reverifiquei se alguma view/consumo foi unificado — tratar como achado original ainda válido, não invalidado, mas não re-confirmado em profundidade nesta fase.

---

## H. Ordem Segura de Correção (recomendação — nada executado)

Como quase todos os "bugs críticos" originais já estão corrigidos, a prioridade muda de "corrigir bugs que mentem" para "esclarecer o estado real de features em transição" antes de qualquer redesign:

1. **Esclarecer o status do rollout do pipeline editorial "canônico"** (`ap-editorial-ai-draft`/`ap-editorial-render-dispatch` vs. o caminho antigo `ap-employee-generator`/`ap-content-production`) — decisão de produto/engenharia, não uma correção de código. Escopo: nenhum arquivo a alterar ainda, é uma pergunta a responder com o time. Risco: nenhum (é leitura/decisão).
2. **Decidir o destino da publicação automática do Instagram**: terminar a conexão Meta OAuth → publish, ou manter pausado e reforçar a mensagem atual. Escopo: `supabase/functions/ap-meta-*`, possível nova função de "publish via conexão OAuth", secrets `AP_LEGACY_PUBLISH_ENABLED`/credenciais. Risco: alto (publicação real em rede social) — exige teste cuidadoso antes de habilitar, mas não é urgente, pois hoje está pausado e comunicado corretamente.
3. **Reverificar a escrita de notificações** (`NotificationCenter.jsx` vs. tabela `notifications`) com leitura completa do componente e das Edge Functions — escopo pequeno, frontend only, risco baixo, mas precisa de confirmação antes de tratar como resolvido ou não.
4. **Confirmar se `converter-os-para-complexa` popula `funcao`** — leitura direta do INSERT completo (não fiz isso ainda). Escopo pequeno, sem mudança de código necessária até confirmar.
5. **Conectar `AutoPublisherMonitoring.jsx`** à navegação — continua um quick win válido e de baixíssimo risco (achado original intacto).
6. **Resolver a dupla `priority`/`prioridade`** — ainda real, ainda pendente, ainda de risco alto por envolver migração de dados (mantém a classificação de risco da auditoria original, seção 22 do relatório anterior).
7. **As 4 migrations aplicadas à produção fora do `origin/main`** deveriam ser reconciliadas com o repositório (trazidas para o histórico de commits) antes de qualquer nova migration, para não perder rastreabilidade — isso é uma correção de processo, não de produto.

---

## I. GO / NO-GO para Fase 0

**NO-GO para a Fase 0 tal como originalmente desenhada** (ela assumia corrigir 4 bugs críticos que, na prática, **já não existem**). Executá-la como planejada seria trabalho desperdiçado ou, pior, poderia reverter correções já feitas.

**GO condicional para uma Fase 0 revisada**, focada em:
- Fechar as poucas lacunas de confirmação que restaram (itens 3 e 4 da seção H — ambos pequenos, leitura adicional, sem mudança de código).
- Tratar a reconciliação de migrations (item 7) como item de higiene antes de qualquer coisa que toque schema.
- Só então avançar para as recomendações estruturais da auditoria original que **continuam válidas e confirmadas**: dupla `priority`/`prioridade`, `AutoPublisherMonitoring.jsx` órfã, exclusão de OS via hard delete, 3 modais/padrões de UI coexistindo (não reverificado nesta fase, mas é um achado de UI pura, de baixo risco de estar desatualizado), e a decisão de produto sobre o pipeline editorial canônico e a publicação automática do Instagram.

A auditoria original continua sendo uma boa base **para a arquitetura de informação e UX geral** (nada nessa dimensão foi invalidado — a auditoria de navegação, modais, Admin×Staff e a maior parte do domínio de Tarefas não foi tocada pelos 150 commits de diferença). O que mudou substancialmente foi especificamente **o subdomínio de produção de conteúdo e publicação do AutoPublisher**, que estava em plena reformulação exatamente no período entre a branch auditada e `origin/main`.

---

## Confirmação final

```
git status
```
executado ao final desta fase: working tree idêntico ao estado inicial — nenhuma alteração de código, configuração, banco ou deploy foi feita durante esta investigação. Apenas este arquivo e o relatório da fase anterior foram criados, ambos em `docs/`, não commitados.
