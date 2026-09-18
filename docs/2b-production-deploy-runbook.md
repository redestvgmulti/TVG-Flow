# 2B Production Deploy Runbook

**Não executar nada deste documento ainda.** Este runbook é o produto de uma
auditoria (`docs/2b-integrated-readiness-report.md`); ele fica pronto para
quando a decisão de prosseguir for tomada, condicionada a resolver o
bloqueador registrado na seção 5.1 do relatório antes de ligar a flag para
qualquer tenant real.

---

## 0. Pré-condições antes de começar

- [ ] Bloqueador da seção 5.1 do readiness report corrigido (migration
      aditiva em `list_my_editorial_articles` removendo o early-return por
      flag) e testado.
- [ ] Achado da seção 5.3/23 corrigido (grants ausentes em
      `save_editorial_article_draft`/`finalize_editorial_article`).
- [ ] QA manual dos checklists `docs/qa/2b2-2-canonical-editor-checklist.md`
      e `docs/qa/2b2-3-ui-wiring-checklist.md` executado por um humano no
      navegador, contra ambiente local ou de staging.
- [ ] Confirmado (de novo, a cada correção acima) que a suíte completa
      continua em 0 regressões novas.

---

## 1. Por que isto não é "quatro deploys separados"

As quatro entregas (#13-#16) são uma única mudança de produto, mas a
pergunta de merge/deploy é sobre **janelas intermediárias**: o Vercel já
demonstrou (fase P0 deste mesmo projeto) que ele publica produção
automaticamente a cada push em `main`. Isso significa que, se os PRs forem
mesclados um a um, **cada merge individual vira um deploy de frontend em
produção**, mesmo que ninguém tenha pedido.

A pergunta certa não é "podemos mergear tudo de uma vez" (não dá — são
branches empilhados, cada um depende do anterior) — é **"cada estado
intermediário de `main`, sozinho, é seguro de rodar em produção?"**

## 2. Matriz de segurança por estado de `main`

| Estado de `main` | Banco | Edge Functions | Frontend | Seguro? |
|---|---|---|---|---|
| Hoje (antes de qualquer merge) | Sem R1/2B | Sem `ap-editorial-render-dispatch` | 100% legado | Baseline |
| Migrations R1+2B.1 aplicadas, **antes** de mergear #13 | +11 migrations (R1×4 + 2B.1×7) | inalterado | 100% legado (branch não mesclado ainda) | Seguro — schema novo, nada o referencia |
| **Merge #13** | idem | inalterado | idem — **zero arquivo frontend em #13** | Seguro |
| Migration 2B.2.1 aplicada + Edge Function `ap-editorial-render-dispatch` deployada, **antes** de mergear #14 | +1 migration | + função nova, live, mas não chamada por nada | 100% legado | Seguro — a função exige um artigo em `ready_for_render`, que não pode existir sem UI para chegar lá |
| **Merge #14** | idem | idem | idem — **zero arquivo frontend em #14** | Seguro |
| **Merge #15** | idem (0 migrations novas) | idem | + `CanonicalEditorialEditor` + rota `/dev/editorial-editor` (`import.meta.env.DEV`-only, **confirmado ausente do bundle de produção** por grep nesta auditoria e nas duas anteriores) | Seguro — nada novo é alcançável em produção |
| **Merge #16, flag OFF (padrão de fábrica)** | idem | idem | + wiring condicional em `AutoPublisher.jsx`/`EmployeeMode.jsx`/`MyNewsWork.jsx`, mas `resolveCreationMode(false) → LEGACY` para todo tenant sem linha em `ap.editorial_feature_flags` | Seguro — código novo existe mas é inalcançável até alguém ligar a flag |
| **Flag ligada para um tenant piloto** | idem | idem | Editor canônico ativo só para esse tenant | **Condicional — ver seção 0** |

**Resposta às 4 perguntas da seção 32 do pedido**:

> É seguro mergear #13 sozinho? **Sim.** Zero arquivo frontend, schema novo inerte.

> É seguro mergear #14 antes de #15/#16? **Sim.** Mesma razão — Edge Function nova, mas inalcançável sem UI.

> O frontend em cada estado intermediário é compatível? **Sim, em todos os estados**, inclusive depois de #16, porque o flag-off é o padrão e o dead-code do editor novo nunca executa.

> As migrations precisam entrar antes de qual merge? **Antes de #13** (as 11 migrations R1+2B.1) **e antes de #14** (a 1 migration de 2B.2.1) — mesma disciplina já usada no deploy do P0: banco primeiro, merge depois, nunca o contrário.

## 3. Feature flag como proteção real (seção 33) — comprovado, não assumido

- Frontend novo **realmente** fica atrás da flag: `resolveCreationMode`
  (única função de decisão, usada em ambos os hosts) retorna `LEGACY`
  sempre que `editorialFlag.enabled !== true` — testado isoladamente
  (`editorial-editor-contract.test.mjs`).
- A rota nova (`/dev/editorial-editor`) não é usada em produção — comprovado
  por build + grep, três vezes ao longo desta cadeia (2B.2.2, 2B.2.3, esta
  auditoria).
- Backend legado permanece compatível — confirmado pela suíte completa (543
  passando, todas as suítes legadas inclusas) sem nenhuma nova falha.
- **Ressalva descoberta nesta auditoria**: a flag protege bem a
  **criação** (seção 8/9), mas **não protege visibilidade de artigos já
  criados** — ver bloqueador 5.1 do readiness report. Antes desta auditoria,
  isso não estava comprovado, só assumido; agora está desmentido para leitura
  e confirmado para escrita.

## 4. Runbook de deploy (depois das pré-condições da seção 0)

1. **Backup/baseline** — mesmo procedimento já usado no deploy do P0: snapshot
   do banco de produção antes de qualquer migration, baseline de contagens
   das tabelas tocadas (`ap.candidate_news`, `ap.news_backlog`,
   `ap.editorial_feature_flags` se já existir).
2. **Migrations** — aplicar, nesta ordem exata, via `supabase db push` (ou
   SQL Editor manual se o CLI estiver bloqueado, como já aconteceu no deploy
   do P0):
   - As 11 migrations R1+2B.1 (antes de mergear #13).
   - Validar com uma consulta simples (`SELECT COUNT(*) FROM ap.editorial_articles`
     deve retornar 0 — tabela nova, vazia).
   - A migration de `get_editorial_article_for_edit` (antes de mergear #14).
   - As 2 migrations de correção desta auditoria (seção 0), quando prontas.
3. **Edge Function** — `supabase functions deploy ap-editorial-render-dispatch`
   (antes de mergear #14). Confirmar no dashboard que `verify_jwt = true`
   está ativo.
4. **Merges/frontend** — mergear #13 → #14 → #15 → #16, nesta ordem, cada um
   depois de retarget para `main` (ver seção 5). Cada merge dispara o deploy
   automático do Vercel; **não há passo manual de deploy de frontend
   separado**, mas cada estado intermediário já foi comprovado seguro na
   matriz acima.
5. **Feature flag permanece OFF** — nenhuma ação aqui; é o padrão de
   fábrica (ausência de linha em `ap.editorial_feature_flags` = `false`).
   Confirmar com uma query (`SELECT * FROM ap.editorial_feature_flags` deve
   retornar 0 linhas, ou só linhas de tenants explicitamente testados antes).
6. **Validação pós-deploy** — repetir a suíte de smoke do P0 (candidatos
   antigos continuam navegáveis, publisher continua desabilitado por
   padrão) mais: confirmar que `Configurações → Fluxo editorial` aparece e
   está "Inativo" para o tenant de teste; confirmar que criar uma matéria
   nova ainda abre o formulário legado.
7. **Ativar apenas o tenant/coorte piloto** (seção 5, abaixo).
8. **QA no piloto** — os checklists já existentes, executados contra o
   tenant piloto real.
9. **Rollback**, se necessário — seção 6.

## 5. Piloto (seção 35)

- **Escopo**: um único tenant, de preferência interno ou de baixo risco
  operacional (não um cliente com volume alto de publicação diária).
- **Usuários**: um admin + 1-2 staff desse tenant, avisados de que estão
  testando um fluxo novo.
- **Ativação**: `Configurações → Fluxo editorial → ligar`, feito pelo
  próprio admin do tenant (a RPC já garante que só ele pode).
- **Monitoramento**: acompanhar logs estruturados de
  `ap-editorial-render-dispatch` (já emite `component/correlation_id/stage/result`
  sem dados sensíveis) e a aba `Revisão editorial` diariamente durante o
  piloto.
- **Não ligar para todos os tenants de uma vez** — a flag é por tenant
  exatamente para permitir isso.

## 6. Rollback

| Camada | Ação | Observação |
|---|---|---|
| **Flag** | Desligar imediatamente (`Configurações → Fluxo editorial`) | Efeito instantâneo — próxima criação já cai no legado. **Mas, até o bloqueador 5.1 ser corrigido, isso também esconde artigos em andamento do piloto — não usar como rollback sem a correção aplicada primeiro, ou aceitar que alguém com acesso a SQL direto precisará recuperar o `article_id` manualmente.** |
| **Frontend** | Reverter para o deployment anterior no Vercel (rollback nativo da plataforma) | Não requer reverter migrations — o frontend antigo simplesmente não referencia as tabelas/RPCs novas. |
| **Edge Function** | Reverter para a versão anterior, ou desabilitar (`supabase functions delete` só em último caso — preferir apenas parar de chamá-la desligando a flag) | Não há necessidade de apagar a função; ela é inofensiva sem chamadas. |
| **Banco** | **Nada é destruído.** Estruturas aditivas (tabelas, colunas, RPCs) permanecem. Artigos criados durante o piloto **não são apagados** — continuam acessíveis via `get_editorial_article_for_edit` mesmo com a flag desligada (ver ressalva na seção 3). | Nunca rodar um `DROP TABLE`/migration reversa como parte de rollback — 2B é aditivo por desenho; reverter destruiria trabalho real do piloto. |

**Princípio do rollback**: desligar a flag e reverter o frontend resolve
99% dos cenários de rollback sem tocar no banco. O banco só teria motivo
para mudar se um bug de **escrita** corrompesse dados — o que a suíte de
testes (543 casos, incluindo concorrência real e freeze) não encontrou
nesta auditoria.
