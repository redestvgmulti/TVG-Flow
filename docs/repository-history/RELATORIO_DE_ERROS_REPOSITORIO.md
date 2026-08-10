# Relatorio De Erros Do Repositorio

Data da auditoria: 2026-03-20

Escopo:
- Varredura estrutural completa do repositorio
- Leitura de configuracoes principais (`package.json`, `eslint.config.js`, `vite.config.js`, `README.md`, rotas e servicos centrais)
- Execucao de `npm run lint`
- Execucao de `npm run build`

Observacao:
- Este documento apenas identifica inconsistencias e erros. Nenhuma correcao funcional foi aplicada.
- O lint trouxe erros reais do produto, mas tambem muito ruido de arquivos gerados, arquivados e scripts Node que estao sendo analisados pela configuracao atual.

## Resumo Executivo

- `npm run lint` falhou com `294 errors` e `42 warnings`, distribuido em `69` arquivos.
- `npm run build` passou, mas com alerta de bundle muito grande:
  - `dist/assets/index-BZd2e6Pu.js` com cerca de `2.44 MB`
- Existem erros de runtime confirmados no frontend, principalmente em rotas, uso de Hooks e referencias a funcoes/estados inexistentes.
- Existe drift de arquitetura entre:
  - rotas registradas x navegacao
  - nomes de status em ingles x portugues
  - `import.meta.env` x `process.env`
  - branding `TVG Flow` x `FlowOS`
  - documentacao atual x codigo real

## Erros Criticos Confirmados

### 1. Rota de criacao de OS quebrada no admin

Achado:
- A tela admin navega para `/admin/tasks/new`, mas a rota registrada no app e `/admin/tarefas/nova`.

Referencias:
- `src/pages/admin/Tasks.jsx:435`
- `src/App.jsx:123`
- `src/pages/admin/Dashboard.jsx:310`

Impacto:
- A acao de abrir criacao de OS a partir da lista pode falhar em runtime por navegar para uma rota inexistente.

### 2. Reabertura de OS usa funcao inexistente e status inconsistente

Achado:
- O detalhe da OS chama `handleReopenTask(selectedTask)`, mas essa funcao nao existe.
- A funcao existente e `handleReopen()`.
- A reabertura grava status `pending`, enquanto o dominio principal trabalha com `pendente`.

Referencias:
- `src/pages/admin/Tasks.jsx:643`
- `src/pages/admin/Tasks.jsx:651`
- `src/pages/admin/Tasks.jsx:1413`
- `src/services/taskService.js:22`
- `src/utils/validators.js:5`

Impacto:
- Acao de reabertura pode falhar em runtime.
- Mesmo quando corrigida a chamada, ainda ha risco de gravar status fora do padrao esperado pela aplicacao.

### 3. Uso invalido de Hooks no modal de edicao

Achado:
- O componente retorna `null` antes da declaracao de varios Hooks.

Referencias:
- `src/components/EditTaskModal.jsx:11`
- `src/components/EditTaskModal.jsx:13`
- `src/components/EditTaskModal.jsx:34`
- `src/components/EditTaskModal.jsx:38`
- `src/components/EditTaskModal.jsx:237`
- `src/components/EditTaskModal.jsx:240`

Impacto:
- Violacao direta das regras de Hooks do React.
- Alto risco de comportamento inconsistente em renderizacao e atualizacao de estado.

### 4. Uso invalido de Hooks no dashboard do staff

Achado:
- O componente retorna `LoadingScreen` antes do `useEffect`.

Referencias:
- `src/pages/staff/Dashboard.jsx:43`
- `src/pages/staff/Dashboard.jsx:47`
- `src/pages/staff/Dashboard.jsx:51`
- `src/pages/staff/Dashboard.jsx:55`

Impacto:
- Violacao das regras de Hooks.
- Pode produzir bugs intermitentes e quebrar expectativa do React em diferentes ciclos de render.

### 5. `ExecutionView` usa estado fora do escopo

Achado:
- O componente `ExecutionView` nao recebe `setSelectedTask` na assinatura.
- Mesmo assim ele chama `setSelectedTask(null)` ao concluir a conversao.

Referencias:
- `src/pages/staff/Tasks.jsx:593`
- `src/pages/staff/Tasks.jsx:1140`

Impacto:
- Erro de runtime ao executar esse fluxo.

### 6. Sidebar usa funcoes antes da declaracao

Achado:
- O `useEffect` chama `fetchIncompleteTaskCount()` e `fetchUpcomingMeetingsCount()` antes dessas funcoes serem declaradas.
- O proprio lint acusou isso como erro de imutabilidade/ordem de declaracao.

Referencias:
- `src/layout/Sidebar.jsx:33`
- `src/layout/Sidebar.jsx:35`
- `src/layout/Sidebar.jsx:36`
- `src/layout/Sidebar.jsx:64`
- `src/layout/Sidebar.jsx:88`

Impacto:
- Comportamento inconsistente e forte indicio de estrutura fragil no componente.

## Inconsistencias Estruturais Relevantes

### 7. Drift entre Vite e variaveis de ambiente

Achado:
- A base usa `import.meta.env.VITE_*` no client Supabase.
- Alguns componentes ainda usam `process.env.REACT_APP_*` e `process.env.NODE_ENV`.

Referencias:
- `src/services/supabase.js:3`
- `src/services/supabase.js:4`
- `src/components/ConversaoWorkflowModal.jsx:124`
- `src/components/ErrorBoundary.jsx:41`
- `src/hooks/useVersionGate.js:39`

Impacto:
- Inconsistencia de plataforma.
- Partes do frontend podem nao receber configuracao corretamente em ambiente Vite.

### 8. Modelo de status fragmentado

Achado:
- Existem constantes em ingles (`pending`, `in_progress`, `completed`, `overdue`) convivendo com validacoes e regras em portugues (`pendente`, `em_execucao`, `concluida`, `atrasada`).
- Algumas telas fazem mapeamento proprio e outras gravam diretamente valores diferentes.

Referencias:
- `src/utils/constants.js:24`
- `src/utils/statusUtils.js:1`
- `src/utils/validators.js:5`
- `src/pages/admin/Tasks.jsx:21`
- `src/pages/admin/Tasks.jsx:75`
- `src/pages/staff/Tasks.jsx:266`

Impacto:
- Alto risco de filtros quebrados, contagens erradas, badges inconsistentes e gravacao de status fora do padrao esperado.

### 9. Servico de dashboard com dados mockados e sem uso aparente

Achado:
- Existe um `dashboardService` com dados mockados e imports nao usados.
- Nao ha evidencia de uso desse servico no frontend atual.

Referencias:
- `src/services/dashboardService.js:1`
- `src/services/dashboardService.js:4`
- `src/services/dashboardService.js:8`

Impacto:
- Codigo morto ou legado parcialmente abandonado.
- Aumenta ruido de manutencao e dificulta entender qual fonte de dados e a oficial.

### 10. Lint nao e um gate confiavel hoje

Achado:
- O script de lint roda `eslint .`.
- A configuracao global ignora apenas `dist`.
- Isso faz o ESLint analisar arquivos gerados, artefatos antigos, backup e scripts Node sob regras de browser.

Referencias:
- `package.json:9`
- `eslint.config.js:8`
- `dev-dist/sw.js`
- `dev-dist/workbox-137dedbd.js`
- `dev-dist/workbox-a87ad30a.js`
- `dev-dist/workbox-b79e8dca.js`
- `_archive/verify_isolation.js`
- `query.js`
- `test-db.js`
- `test-upload.js`
- `src/components/forms/TaskForm.jsx.backup`
- `vite.config.js.timestamp-1767036058030-2d84498d39c1a.mjs`

Impacto:
- O comando acusa problemas reais, mas mistura esses problemas com ruido de repositrio.
- Fica dificil usar o lint como criterio confiavel de qualidade ou CI.

### 11. Build altera arquivo versionado

Achado:
- O plugin `VersionSyncPlugin` escreve em `public/system-version.json` durante a build.

Referencias:
- `vite.config.js:22`
- `vite.config.js:24`
- `vite.config.js:25`
- `public/system-version.json`

Impacto:
- `npm run build` suja o working tree.
- A build deixa de ser operacionalmente neutra dentro do repositorio.

### 12. ESM no projeto, CommonJS em scripts versionados

Achado:
- O projeto esta em `type: module`.
- Ainda existem scripts versionados com `require(...)` e acesso a `process` assumindo ambiente CommonJS sem configuracao especifica de lint.

Referencias:
- `package.json:5`
- `query.js:1`
- `test-db.js:1`
- `test-upload.js:1`

Impacto:
- Inconsistencia de padrao.
- Falhas no lint e maior ambiguidade sobre como esses scripts devem ser executados.

### 13. Script versionado com erro sintatico

Achado:
- `check.mjs` contem `export` fora do topo do modulo.

Referencia:
- `check.mjs:354`

Impacto:
- Arquivo nao parseia corretamente.

## Drift De Documentacao E Produto

### 14. README desatualizado em relacao ao codigo

Achado:
- O README descreve estrutura antiga de pastas.
- O README fala em apenas dois perfis, mas o app ja tem area de super admin.
- O README marca como "proximos passos" itens que ja existem no codigo, como dashboards, calendario, push, edge functions e PWA.

Referencias:
- `README.md:53`
- `README.md:80`
- `README.md:152`
- `src/App.jsx:169`
- `vite.config.js:45`
- `supabase/functions/create-tenant/index.ts`

Impacto:
- Onboarding incorreto.
- Documentacao nao representa o estado real do projeto.

### 15. Branding misturado entre `TVG Flow` e `FlowOS`

Achado:
- O repositorio, a interface, o manifest e partes do super admin usam nomes diferentes para o produto.

Referencias:
- `package.json:2`
- `README.md:1`
- `src/layout/Sidebar.jsx:136`
- `src/components/LoadingScreen.jsx:10`
- `public/manifest.json:2`
- `src/layout/SuperAdminLayout.jsx:31`

Impacto:
- Inconsistencia de identidade do produto.
- Aumenta confusao entre nome do sistema, deploy e interface.

## Achados Da Auditoria Automatizada

### Resultado do `npm run lint`

Total:
- Arquivos com ocorrencias: `69`
- Erros: `294`
- Avisos: `42`

Padroes predominantes:
- `no-unused-vars`
- `react-hooks/rules-of-hooks`
- `react-hooks/exhaustive-deps`
- `no-undef`
- `react-refresh/only-export-components`
- `no-empty`
- `no-case-declarations`
- `no-useless-escape`
- `no-useless-catch`

Ruido predominante de configuracao:
- `dev-dist/*`
- `_archive/*`
- scripts Node sob regra de browser

### Resultado do `npm run build`

Resultado:
- Build concluida com sucesso

Alertas:
- Bundle principal grande:
  - `dist/assets/index-BZd2e6Pu.js` aproximadamente `2,444.01 kB`
- O proprio build sugere code splitting e `manualChunks`

## Apndice A - Contagem Completa Do Lint Por Arquivo

Legenda:
- `E` = errors
- `W` = warnings

```text
_archive/verify_isolation.js                     E:4   W:0
check.mjs                                        E:1   W:0
dev-dist/sw.js                                   E:3   W:0
dev-dist/workbox-137dedbd.js                     E:38  W:4
dev-dist/workbox-a87ad30a.js                     E:38  W:4
dev-dist/workbox-b79e8dca.js                     E:38  W:4
query.js                                         E:4   W:0
scripts/check_anon_key.js                        E:1   W:0
scripts/check_policies_stub.js                   E:6   W:0
scripts/test_upload.js                           E:4   W:0
scripts/tests/test_anthropic.js                  E:1   W:0
scripts/tests/test_auth.js                       E:2   W:0
src/components/BlockedActionModal.jsx            E:1   W:0
src/components/ConversaoWorkflowModal.jsx        E:1   W:1
src/components/EditTaskModal.jsx                 E:22  W:1
src/components/ErrorBoundary.jsx                 E:1   W:0
src/components/MacroTaskDetail.jsx               E:1   W:1
src/components/MicroTaskTimeline.jsx             E:1   W:1
src/components/MicroTasksList.jsx                E:0   W:1
src/components/NotificationCenter.jsx            E:1   W:1
src/components/PageTransition.jsx                E:1   W:0
src/components/ProfessionalCompanyLinks.jsx      E:0   W:1
src/components/PullToRefresh.jsx                 E:1   W:0
src/components/SLAIndicator.jsx                  E:2   W:0
src/components/SystemIntegrityCheck.jsx          E:0   W:1
src/components/TenantErrorBoundary.jsx           E:1   W:0
src/components/Timeline.jsx                      E:3   W:1
src/components/UpdateBanner.jsx                  E:2   W:0
src/components/dashboard/OperationalFeed.jsx     E:0   W:1
src/components/dashboard/TaskSummaryModal.jsx    E:2   W:1
src/components/forms/TaskForm.jsx                E:2   W:1
src/contexts/AuthContext.jsx                     E:6   W:1
src/contexts/InAppNotificationContext.jsx        E:1   W:1
src/contexts/RefreshContext.jsx                  E:1   W:0
src/features/editorial/EditorialEngine.jsx       E:1   W:0
src/hooks/useVersionGate.js                      E:1   W:0
src/layout/Header.jsx                            E:2   W:0
src/layout/Sidebar.jsx                           E:2   W:1
src/main.jsx                                     E:1   W:0
src/pages/admin/Areas.jsx                        E:1   W:0
src/pages/admin/AutoPublisher.jsx                E:12  W:0
src/pages/admin/AutoPublisherSettings.jsx        E:1   W:0
src/pages/admin/Companies.jsx                    E:1   W:1
src/pages/admin/CompanyDetails.jsx               E:0   W:1
src/pages/admin/Dashboard.jsx                    E:18  W:1
src/pages/admin/EmployeeMode.jsx                 E:1   W:0
src/pages/admin/Reports.jsx                      E:1   W:1
src/pages/admin/Tasks.jsx                        E:16  W:2
src/pages/admin/professionals/Edit.jsx           E:0   W:1
src/pages/admin/professionals/ProfessionalForm.jsx E:1 W:0
src/pages/admin/professionals/index.jsx          E:1   W:0
src/pages/admin/tasks/NewOS.jsx                  E:5   W:0
src/pages/staff/Calendar.jsx                     E:0   W:1
src/pages/staff/Dashboard.jsx                    E:6   W:1
src/pages/staff/RequestCreate.jsx                E:0   W:1
src/pages/staff/Tasks.jsx                        E:7   W:2
src/pages/staff/Today.jsx                        E:1   W:1
src/pages/super-admin/ReportsPage.jsx            E:0   W:1
src/pages/super-admin/TenantDetail.jsx           E:1   W:1
src/routes/StrictSuperAdminRoute.jsx             E:1   W:0
src/services/calendarService.js                  E:2   W:0
src/services/clientService.js                    E:2   W:0
src/services/dashboardMetrics.js                 E:1   W:0
src/services/dashboardService.js                 E:8   W:0
src/services/meetingService.js                   E:2   W:0
src/services/resolveClienteId.js                 E:1   W:0
src/utils/dateUtils.js                           E:1   W:0
test-db.js                                       E:4   W:0
test-upload.js                                   E:2   W:0
```

## Apndice B - Arquivos Com Maior Concentração De Ocorrencias

Top arquivos:
- `dev-dist/workbox-137dedbd.js`: `38 errors`, `4 warnings`
- `dev-dist/workbox-a87ad30a.js`: `38 errors`, `4 warnings`
- `dev-dist/workbox-b79e8dca.js`: `38 errors`, `4 warnings`
- `src/components/EditTaskModal.jsx`: `22 errors`, `1 warning`
- `src/pages/admin/Dashboard.jsx`: `18 errors`, `1 warning`
- `src/pages/admin/Tasks.jsx`: `16 errors`, `2 warnings`
- `src/pages/admin/AutoPublisher.jsx`: `12 errors`
- `src/services/dashboardService.js`: `8 errors`
- `src/pages/staff/Tasks.jsx`: `7 errors`, `2 warnings`
- `src/contexts/AuthContext.jsx`: `6 errors`, `1 warning`
- `src/pages/staff/Dashboard.jsx`: `6 errors`, `1 warning`
- `scripts/check_policies_stub.js`: `6 errors`
- `src/pages/admin/tasks/NewOS.jsx`: `5 errors`

Leitura recomendada desses blocos:
- Primeiro separar os arquivos de ruido (`dev-dist`, `_archive`, scripts antigos, backups).
- Depois atacar os erros reais de aplicacao:
  - `src/components/EditTaskModal.jsx`
  - `src/pages/admin/Tasks.jsx`
  - `src/pages/staff/Tasks.jsx`
  - `src/pages/staff/Dashboard.jsx`
  - `src/layout/Sidebar.jsx`
  - `src/contexts/AuthContext.jsx`

## Conclusao

O repositorio tem uma combinacao de:
- bugs reais de runtime
- drift de arquitetura
- documentacao desatualizada
- higiene de repositrio fragil
- configuracao de lint que mistura sinal e ruido

O principal ponto de atencao nao e apenas a quantidade de erros, mas o fato de que parte deles atinge fluxos centrais da aplicacao:
- abrir OS nova
- reabrir OS
- editar OS
- dashboard do staff
- conversao de OS para workflow

