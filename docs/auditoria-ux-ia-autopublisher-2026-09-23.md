# Auditoria de UX, Arquitetura de Informação e Fluxos — TVG Flow / AutoPublisher

**Data:** 2026-09-23
**Branch auditada:** `fix/autopublisher-legacy-modal-ui` (HEAD `c981b1e`, working tree limpo)
**Natureza:** 100% investigação, read-only. Nenhum arquivo de código, migration, rota ou CSS foi alterado nesta etapa.
**Método:** leitura direta de código-fonte (frontend `src/`, Edge Functions `supabase/functions/`, migrations `supabase/migrations/`) por 4 pesquisas paralelas + síntese. Toda afirmação cita arquivo/função/tabela/RPC/Edge Function sempre que possível. Onde não foi possível confirmar apenas pelo código, está marcado **NÃO CONFIRMADO**. Bugs críticos encontrados estão marcados **BUG CRÍTICO ENCONTRADO — NÃO ALTERADO** e não foram corrigidos.

> Nota de contexto (memória do projeto): o TVG Flow não tem ambiente de staging — o único Supabase remoto é produção, e o Preview da Vercel aponta para o mesmo banco. Além disso há uma issue conhecida (#5) de que as migrations versionadas não reconstroem fielmente o schema real de produção. Vários achados desta auditoria (especialmente no domínio de Tarefas/OS) dependem de comparar código-fonte com um schema que pode ter divergido do banco real — nesses casos o relatório sinaliza explicitamente a incerteza, mas mantém o achado porque há evidência corroborante (comentários do próprio time no código, ou padrões consistentes de nomenclatura).

---

## 1. Resumo Executivo

O TVG Flow é um produto tecnicamente sofisticado — especialmente o pipeline do AutoPublisher, que tem ingestão automática (RSS/Radar), scoring, geração de arte via Placid, revisão, aprovação, agendamento e (teoricamente) publicação automática no Instagram, além de um sistema completo de observabilidade (`AutoPublisherMonitoring.jsx`). O problema identificado não é falta de poder, é que **a máquina de estados interna do backend foi transportada quase 1:1 para a interface**, e que **partes inteiras do sistema foram construídas e nunca conectadas** ao restante do produto.

Achados mais graves (todos com evidência de código, detalhados nas seções seguintes):

1. **A publicação real no Instagram é 100% manual e não verificada.** O botão "Publicar" apenas marca `status='posted'` no banco — não chama a Graph API. O pipeline automático (`ap-scheduler` + `ap-instagram-publisher`) existe, mas `ap-scheduler` nunca é invocado por nada no repositório, e mesmo se fosse, produz um status (`queued_for_posting`) que `ap-instagram-publisher` nunca consulta (ele busca `approved`). Dois sistemas incompatíveis coexistem, e o usuário opera manualmente por fora sem saber.
2. **Nenhum LLM roda no caminho de produção de conteúdo.** A tela "Motor de IA" (em Configurações) configura um pipeline (`runEditorialWorkflow`/`llmClient.ts`) que **não é chamado por nenhuma Edge Function do fluxo real** — só é exercitado pela tela de teste ("Validação"). O texto de matérias reais passa por um passthrough (`canonicalEditorialFields`) documentado no próprio código como "sem gerar ou reescrever texto".
3. **Um dashboard de observabilidade completo (`AutoPublisherMonitoring.jsx`) está órfão** — sem rota, sem link em nenhum menu, tecnicamente inacessível a qualquer usuário.
4. **Ação "Solicitar Ajuste" (devolver etapa de tarefa) está quebrada**: o frontend chama `return-micro-task` (singular), a Edge Function real se chama `return-micro-tasks` (plural). Toda tentativa falha.
5. **Notificações nunca podem ser marcadas como lidas de fato**: o centro de notificações lê de duas tabelas (`notificacoes` PT e `notifications` EN), mas as ações de marcar como lida/limpar só escrevem na tabela PT — e todo o domínio de tarefas grava na tabela EN.
6. **RPC `discard_news_backlog_item` (botão "Descartar" no Banco de Matérias) não existe** em nenhuma migration — o botão deve falhar sempre.
7. **Exclusão de tarefas/OS ignora a Edge Function dedicada** (`excluir-os`, com soft-delete e auditoria) e faz `DELETE` direto no cliente, deixando arquivos órfãos no Storage e apagando o próprio rastro de auditoria via cascata.
8. **Pelo menos 3 sistemas de modal diferentes coexistem** no mesmo produto (componente oficial `ui/Modal.jsx`, `.modal-backdrop` "hand-rolled", `createPortal` com estilos inline), com comportamento inconsistente de fechar/ESC/foco.
9. **O mesmo objetivo ("criar matéria") tem duas implementações completamente distintas** para Admin (wizard de 4-5 passos) e Staff (formulário único), com lógica de validação duplicada no cliente.
10. Termos ambíguos — "Empresas" significa coisas diferentes em Admin (clientes operacionais) e Super Admin (tenants da plataforma); pelo menos 13 valores de `status` do AutoPublisher são mapeados para só 4 abas, mas os badges individuais ainda vazam nomenclatura técnica ("Renderizando", "IA Gerando" — sem geração de IA real).

Em resumo: a hipótese levantada no briefing da auditoria — **arquitetura de software apresentada como arquitetura de produto** — se confirma fortemente, tanto em Tarefas/OS quanto (de forma ainda mais acentuada) no AutoPublisher. O maior risco não é "a interface é feia", é que **partes do produto que parecem funcionar (publicar, marcar notificação como lida, devolver tarefa, descartar pauta) na verdade não fazem o que dizem fazer**, silenciosamente.

---

## 2. Mapa do Produto (Baseline Técnico + Admin / Staff / Super Admin)

**Stack:** Vite 5 + React 19 + React Router 6 (`react-router-dom`) + Supabase JS v2. Sem TypeScript no frontend. Sem biblioteca de UI/modal (Radix, Headless UI etc.) — todo componente é custom. `sonner` para toasts. `framer-motion`, `recharts`, `react-big-calendar`.

**Backend:** Supabase (Postgres + 40 Edge Functions em `supabase/functions/`, a maioria em Deno/TS). Não há camada de API própria — o frontend fala direto com Postgres via PostgREST (RLS) e invoca Edge Functions para lógica que precisa de service role ou orquestração multi-tabela.

**Três níveis de acesso**, cada um com seu próprio layout e conjunto de rotas:

- **Admin** (`src/pages/admin/`, `RoleProtectedRoute allowedRole="admin"`) — gestão operacional de um tenant (agência).
- **Staff / Profissional** (`src/pages/staff/`, `RoleProtectedRoute allowedRole="staff"`) — operador que executa tarefas e usa o AutoPublisher em modo simplificado.
- **Super Admin** (`src/pages/super-admin/`, `StrictSuperAdminRoute`) — gestão multi-tenant da plataforma (a própria TVG administrando as agências-cliente).

O menu de navegação central vive em `src/config/navigation.js` (`NAV_ITEMS`, com campo `roles` por item) e é consumido por `src/layout/Sidebar.jsx` e `src/layout/BottomNav.jsx` — **exceto** o Super Admin, cujo menu é hard-coded localmente em `SuperAdminLayout.jsx`, quebrando a "fonte única de verdade" que o comentário do próprio `navigation.js` promete.

---

## 3. Mapa de Navegação Completo

### ADMIN (`/admin/*`)

| Item de menu | Rota | Componente | Finalidade |
|---|---|---|---|
| Dashboard | `/admin` (index) / `/admin/dashboard` | `Dashboard.jsx` | Visão executiva operacional |
| Tarefas | `/admin/tasks` | `Tasks.jsx` | Gestão de OS/tarefas |
| Banco de Matérias | `/admin/autopublisher/backlog` | `AutoPublisher.jsx` (via `NewsBacklogPanel`) | Fila de pautas do AutoPublisher |
| Assistentes | `/admin/content` | `AdminContent.jsx` | CRUD de assistentes GPT |
| Agenda | `/admin/calendar` | `Calendar.jsx` | Calendário de tarefas |
| Reuniões | `/admin/meetings` | `Meetings.jsx` | CRUD de reuniões |
| AutoPublisher | `/admin/autopublisher` (+ `templates`, `settings`) | `AutoPublisher*.jsx` | Pipeline editorial (grupo colapsável) |
| Empresas | `/admin/companies`, `/admin/companies/:id` | `Companies.jsx`, `CompanyDetails.jsx` | CRUD de clientes operacionais do tenant |
| Equipe | `/admin/professionals` | `professionals/index.jsx` | Gestão de profissionais |
| Relatórios | `/admin/reports` | `Reports.jsx` | Relatórios por cliente/colaborador |

**Rotas sem item de navegação (órfãs, só acessíveis digitando a URL):**
- `/admin/areas` (`Areas.jsx` — Setores) — não aparece em `NAV_ITEMS` nem no grupo "Administração" do Sidebar.
- `/admin/tarefas/nova` (`tasks/NewOS.jsx`) — só alcançável via `handleCreateTask()` do Dashboard, sem link direto.
- `/admin/professionals/:id/edit` (`professionals/Edit.jsx`) — nada no código navega para cá; a lista edita via modal in-page.

### STAFF (`/staff/*`)

| Item de menu | Rota | Componente | Bottom-nav mobile |
|---|---|---|---|
| Dashboard | `/staff/dashboard` | `staff/Dashboard.jsx` | sim |
| Tarefas | `/staff/tasks` | `staff/Tasks.jsx` | sim |
| Agenda | `/staff/calendar` | `staff/Calendar.jsx` | sim |
| Reuniões | `/staff/meetings` | `staff/Meetings.jsx` | não |
| Solicitar | `/staff/requests/new` | `RequestCreate.jsx` | não (é o FAB/CTA) |
| Assistentes | `/staff/content` | `StaffContent.jsx` | sim |
| Criar Matérias | `?modal=employee-mode` (query param, não é rota própria) | `EmployeeMode.jsx` (montado globalmente em `AppLayout.jsx`) | não |
| Perfil | `/staff/profile` | `staff/Profile.jsx` | sim |

**Rota órfã:** `/staff/today` (`Today.jsx`) — tela "Hoje" completa e funcional (lista do dia + conclusão rápida), **sem nenhum link em lugar nenhum do produto**. Além disso tem um bug de schema próprio (ver §9).

### SUPER ADMIN (`/platform/*`)

| Item | Rota | Componente |
|---|---|---|
| Dashboard | `/platform` | `SuperAdminDashboard.jsx` |
| Empresas (tenants) | `/platform/companies`, `/platform/companies/:id` | `TenantListPage.jsx`, `TenantDetail.jsx` |
| Relatórios | `/platform/reports` | `ReportsPage.jsx` |
| Status do Sistema | `/platform/system` | `SystemStatusPage.jsx` |
| Perfil | `/platform/profile` | reaproveita `staff/Profile.jsx` |

Menu hard-coded em `SuperAdminLayout.jsx`, fora de `navigation.js`.

### Fora de role
`Login.jsx`, `ResetPassword.jsx` — funcionais e bem construídos. `Suspended.jsx` (`/suspended`) — **código morto**: nenhuma parte do código redireciona para essa rota; `ProtectedRoute.jsx` sempre renderiza `AccountBlockedScreen.jsx` inline, uma tela quase idêntica, em vez de navegar para `/suspended`.

---

## 4. Inventário de Telas (síntese — evidência completa nas seções 7 e 8 para Tarefas/AutoPublisher)

### Dashboards
- **Admin Dashboard** (`Dashboard.jsx`): 4 KPIs (só "Atrasadas" é clicável — inconsistência de affordance entre os 4 cards do mesmo grupo), gráfico de evolução, `OperationalFeed` em tempo real (`postgres_changes`), lista de tarefas recentes. Clique num item abre `TaskSummaryModal` inline (editar/excluir/reatribuir sem sair da tela).
- **Staff Dashboard** (`staff/Dashboard.jsx`): 4 KPIs pessoais, gráfico de produtividade. Clique num card **navega** para `/staff/tasks` em vez de abrir modal — padrão de interação diferente do Dashboard Admin sem justificativa clara de permissão.
- Os dois dashboards não reaproveitam nenhum componente entre si (dois `AreaChart` configurados quase iguais, dois grids de métrica com markup próprio).

### Calendar / Meetings
- `Calendar.jsx` (admin) e `staff/Calendar.jsx`: telas passivas de consulta (`react-big-calendar` + modal de detalhe somente leitura). Os dois modais de detalhe (`TaskDetailModal` × `StaffTaskDetailModal`) são cópias quase idênticas (~190 linhas cada) em vez de um componente parametrizado.
- `Meetings.jsx` (admin): CRUD completo, cancelamento com modal de confirmação dedicado (bom padrão), mas dois `modal-backdrop` empilhados (zIndex 1100) quando o modal de cancelar abre por cima do de edição.
- `staff/Meetings.jsx`: somente leitura + "Confirmar Presença".

### Empresas / Setores / Equipe
- `Companies.jsx` (admin): CRUD de clientes operacionais. **BUG CRÍTICO ENCONTRADO — NÃO ALTERADO**: função morta `handleCompanyClick` (linha ~196) monta rota com espaços (`` `/ admin / companies / ${id} ` ``) — não é chamada atualmente, mas é uma armadilha se reativada. Botão "Desativar" usa `window.confirm()` nativo, inconsistente com o resto do app.
- `CompanyDetails.jsx`: **BUG CRÍTICO ENCONTRADO — NÃO ALTERADO** — classe CSS malformada por espaços no template literal (`company - status active `, linha ~238) faz o badge de status perder a cor esperada.
- `Areas.jsx` (`/admin/areas`, órfã de navegação): **o toggle Ativo/Inativo é decorativo** — `handleToggleStatus()` só dispara um toast informativo, não altera nada; `fetchAreas()` hard-codeia `ativo: true` porque a coluna não existe no schema atual. UI promete uma função que não existe (consistente com a issue #5 de schema).
- `professionals/index.jsx` + `ProfessionalForm.jsx`: lista com busca, edição via modal, convite por link copiável. Botão "Editar" desabilitado com tooltip explicativo para não-staff (bom). Campo `area_id` é enviado no payload mas **não há UI para selecioná-lo** — não confirmado se é preenchido em outro lugar.
- `professionals/Edit.jsx` (`/admin/professionals/:id/edit`, órfã): fluxo de exclusão **diferente** do da lista — usa `prompt()` nativo pedindo para digitar "DESATIVAR", em vez do modal customizado usado na lista. Mesma ação de negócio, dois padrões de UI, um deles inacessível pela navegação.

### Conteúdo / Assistentes
- `AdminContent.jsx`: CRUD completo de "Assistentes" (GPTs), sem filtrar `ativo` (vê inativos também), sem badge indicando isso.
- `StaffContent.jsx`: somente leitura, filtra `ativo=true` — Admin e Staff podem estar vendo listas diferentes sem nenhuma sinalização visual disso para o Admin.
- `EmployeeMode.jsx` (modal global "Criar Matérias"): ~1220 linhas, quase todo com estilos inline (não usa o design system do resto do app). **Achado de segurança de UX**: é montado globalmente em `AppLayout.jsx`, acima de qualquer `RoleProtectedRoute`, controlado só por `?modal=employee-mode` — o próprio componente não checa role; a restrição hoje é só o menu não oferecer o link para Admin. NÃO CONFIRMADO se as Edge Functions chamadas validam role no backend.

### Relatórios / Super Admin
- `Reports.jsx` (admin): tem código morto — uma 3ª aba "Por Cargo" (RPC `get_role_stats`) existe na lógica mas nunca é renderizada no JSX.
- `TenantListPage.jsx`/`TenantList.jsx`: lê colunas (`users_count`, `active_tasks_count`, `health_status`) que **podem não existir** na tabela `empresas` (padrão do resto do app é usar RPC agregadora, como o próprio `SuperAdminDashboard` faz) — NÃO CONFIRMADO, mas risco real de campos vazios em produção.
- `TenantDetail.jsx`: **"SUSPENDER ACESSO" de um tenant inteiro executa direto no clique, sem modal de confirmação** — a ação destrutiva de maior impacto do produto é a única sem confirmação.
- `ReportsPage.jsx` (super admin): busca tabelas inteiras (`profissionais`, `tarefas`) sem paginação para computar estatísticas client-side — não escala, e roda sempre contra produção (sem staging).
- `SystemStatusPage.jsx`: honesto e simples — mede latência real, bom exemplo a seguir.

---

## 5. Inventário de Modais

**Achado estrutural:** não há biblioteca de modal — tudo é custom, e coexistem **4 padrões de implementação diferentes**: (1) componente oficial `src/components/ui/Modal.jsx` (focus-trap, ESC, scroll-lock — o próprio comentário do arquivo diz "novos modais devem usar este"); (2) `.modal-backdrop`/`.modal` hand-rolled repetido em várias páginas (Tasks, Companies, Areas, Meetings, professionals); (3) `createPortal` direto com estilos inline (`EditTaskModal`, `TaskSummaryModal`); (4) `position:fixed` 100% inline sem as classes padrão (`TenantDetail.jsx`, `AutoPublisherTemplates.jsx`). Resultado prático: comportamento inconsistente de fechar-no-backdrop, ESC e foco entre modais do mesmo produto.

Tabela consolidada (33 modais/diálogos catalogados; ver relatório completo do pesquisador para o detalhamento campo-a-campo de cada um):

| Modal | Quem abre | Carga cognitiva | Observação |
|---|---|---|---|
| Nova Matéria — Wizard (Admin) | admin | **ALTA** | `ArticleWizard.jsx`, 4-5 passos |
| Nova Matéria — Form único (Staff) | staff | **ALTA** | `ArticleForm.jsx` dentro de `EmployeeMode`; mesma finalidade do wizard, implementação e validação duplicadas |
| Editar Matéria | admin | MÉDIA | — |
| Converter em Workflow | admin/super_admin | **ALTA** | ação irreversível, sem undo |
| Editar Tarefa/OS (`EditTaskModal`) | admin (e staff se permitido) | **ALTA** | modal mais reaproveitado do produto (Dashboard, Tasks, execução) — edita metadados, gerencia micro-tarefas e tem "zona de arquivamento irreversível" tudo na mesma tela |
| Vincular Profissionais a Empresa | admin | MÉDIA | — |
| Adicionar Novo Admin (tenant) | super-admin | MÉDIA (alto risco) | não fecha com ESC/clique fora (padrão 4) |
| Excluir Campanha (Templates) | admin | BAIXA | padrão 4, sem ESC/clique fora |
| Demais confirmações (excluir setor, desvincular, cancelar reunião, excluir assistente etc.) | admin | BAIXA | maioria segue algum padrão de confirmação, mas com textos de botão primário inconsistentes ("Sim, desativar" / "Confirmar Exclusão" / "Excluir" / "Transferir e Excluir") |

**Redundância mais relevante encontrada nesta seção:** as duas implementações de "Nova Matéria" (Admin × Staff) chamam a mesma Edge Function (`ap-employee-generator`), mas têm lógica de validação e montagem de payload **duplicada no cliente** (`AutoPublisher.jsx:534-715` vs. equivalente em `EmployeeMode.jsx`), e destinos pós-salvar diferentes (Admin vai para "Pendentes"; Staff vê inline e precisa ir manualmente a "Meu Histórico").

---

## 6. Inventário de Ações e Botões (achados transversais)

- **Inconsistência de confirmação para ações destrutivas**: a maioria do produto usa modal customizado; `Companies.jsx` usa `window.confirm()` nativo; `TenantDetail.jsx` (suspender tenant inteiro) **não usa confirmação nenhuma**. Não há padrão único, e a ação de maior impacto (suspender uma empresa cliente inteira) é a menos protegida.
- **Ícone de exclusão adjacente a CTA primário** em `CompanyDetails.jsx` (lixeira "Desativar Empresa" ao lado do botão primário "Vincular Profissional"), sem separação visual forte.
- **Toggle decorativo ao lado de ação real** em `Areas.jsx` (toggle Ativo/Inativo não faz nada, na mesma linha da tabela que o botão "Excluir", que é real) — risco de o usuário assumir segurança/efeito onde não há.
- Nenhum controle administrativo vazando tecnicamente para Staff foi encontrado nas rotas (guardas corretas) — a única exceção é o modal `EmployeeMode`, acessível independente de role por não ter checagem própria no componente.
- No AutoPublisher, o botão **"Processar Tudo"** (debug/reprocessamento manual de todo o pipeline automático: image-fetcher → scoring → feed-builder → content-production) fica exposto na UI de produção, junto de ações operacionais do dia a dia — mistura clara de ferramenta de operação de sistema com ferramenta de trabalho do usuário final.

---

## 7. Fluxo Completo de Tarefas / OS / Operações

### Caminhos de criação (4 encontrados, sem vocabulário unificado)

| # | Caminho | Onde | Observação |
|---|---|---|---|
| A | Admin → "Nova OS" | `tasks/NewOS.jsx` → `TaskForm.jsx` (993 linhas) → Edge Function `create-os-by-function` | Caminho oficial; 2 sub-modos (Simples / Workflow com etapas e dependências) |
| B | Admin → modal legado "Nova Tarefa" em `Tasks.jsx` | insert direto | **Código morto** — nada mais o aciona; se fosse acionado, o `status` default (`'pending'`, inglês) violaria o CHECK constraint real (`pendente/em_execucao/concluida/atrasada/cancelada`) |
| C | Staff → FAB "Solicitar" | `RequestCreate.jsx` | insert direto, sem Edge Function, sem microtarefas — caminho paralelo e mais simples que o do Admin |
| D | Admin → "Converter em Workflow" (pós-criação) | `ConversaoWorkflowModal.jsx` → Edge Function `converter-os-para-complexa` | ver bug crítico abaixo |

`taskService.createTask()`/`createOS()` existem no serviço mas **não são chamados por nenhum componente ativo** — código morto adicional.

**Campos realmente necessários no momento da criação**: título, empresa, prazo. Tudo mais (modo simples/workflow, seleção de profissionais/etapas, tags) é exposto de uma vez só no mesmo formulário longo, sem opção de rascunho.

### Matriz de status (Tarefas/OS)

| Status | Entidade | Quem altera | Auto/Humano | Próximo |
|---|---|---|---|---|
| `pendente` | tarefas/tarefas_micro | sistema (criação) | automático | `em_execucao`, `cancelada` |
| `em_execucao` | idem | staff ("Iniciar") | humano | `concluida`, `devolvida`, `bloqueada` |
| `concluida` | idem | staff / `complete-micro-task` | humano | terminal (macro) |
| `atrasada` | tarefas | **NÃO CONFIRMADO quem seta** — não há UPDATE explícito encontrado; parece calculado em runtime (`isOverdue()`) na maioria das telas | — | — |
| `cancelada` | tarefas | admin | humano | `pendente` (reabrir) |
| `bloqueada` | tarefas_micro | automático (dependência) | automático | `pendente` |
| `devolvida` | tarefas_micro | staff via "Solicitar Ajuste" | humano — **ação quebrada, ver bug crítico** | `em_execucao` |
| `pending`/`completed` (inglês) | tarefas | só pelo modal morto e por `staff/Today.jsx` | — | **viola o CHECK constraint real** |

**Duplicidade de coluna confirmada no schema** (`remote_schema.sql`, não é suposição): a tabela `tarefas` tem **duas colunas de prioridade simultâneas** — `priority` (inglês, `low/medium/high/urgent`) e `prioridade` (português, `baixa/normal/alta/urgente`). Os caminhos modernos de criação (A, C) só gravam `prioridade`; `staff/Today.jsx` e `dashboardMetrics.js` só leem `priority` — resultado provável: badges de prioridade nunca aparecem corretamente em `Today.jsx`.

### Ciclo, redundâncias e encontrabilidade — achados-chave

- **3 tabelas de histórico paralelas não unificadas** (`os_eventos`, `logs_tarefas`, `tarefas_micro_logs`): a view `os_timeline_view` (usada pela `Timeline.jsx` do Staff) só une `task_comments`+`os_eventos`; o modal `MacroTaskDetail.jsx` do Admin monta seu próprio histórico só de `tarefas_micro_logs`. **Admin e Staff literalmente veem históricos diferentes e não sobrepostos da mesma OS.**
- **2 tabelas de notificação paralelas** (`notificacoes` PT / `notifications` EN) — todas as Edge Functions do domínio gravam em `notifications` (EN), mas marcar como lida/limpar só escreve em `notificacoes` (PT). Notificações de tarefa nunca somem de fato.
- **Tarefas em modo Workflow nunca aparecem em `staff/Today.jsx`** — essa tela só lista pelo campo `assigned_to`, que o modo workflow não preenche (a atribuição fica em `tarefas_micro.profissional_id`).
- **Exclusão de OS bypassa a Edge Function dedicada** (`excluir-os`, soft-delete + auditoria): o frontend faz `DELETE` direto, que cascade-apaga anexos, comentários e o próprio rastro de auditoria (`os_eventos`), sem limpar o Storage físico (arquivos órfãos).
- **Botão "Editar" na lista só aparece para quem criou a OS** (`created_by === user.id`), mas o modal de detalhe permite edição para qualquer `role==='admin'` — duas regras de permissão diferentes para a mesma ação, dependendo de onde ela é acionada.
- Não existe fluxo formal de "aprovar/rejeitar entrega" de tarefa — o mais próximo é "Solicitar Ajuste", que está quebrado.

### Fluxos críticos (estimativa)

- **Staff, do login até concluir uma tarefa**: ~3-4 telas/estados, ~5-6 cliques. Ponto de confusão: a tarefa concluída **desaparece imediatamente** do filtro padrão ("Tudo" exclui concluídas), sem toast explicando para onde foi.
- **Admin, criar OS Múltipla com 3 etapas**: ~10-15 interações num formulário único e longo, sem possibilidade de salvar rascunho.

### Bugs críticos deste domínio

- **BUG CRÍTICO ENCONTRADO — NÃO ALTERADO**: `return-micro-task` (chamado pelo frontend) vs. `return-micro-tasks` (Edge Function real, plural) — toda devolução de etapa falha.
- **BUG CRÍTICO ENCONTRADO — NÃO ALTERADO**: marcação de notificação como lida grava na tabela errada (`notificacoes` em vez de `notifications`).
- **BUG CRÍTICO ENCONTRADO — NÃO ALTERADO**: exclusão de OS ignora `excluir-os`, perde auditoria e deixa arquivos órfãos.
- **NÃO CONFIRMADO, mas corroborado por comentários do próprio time no código**: criação de OS Múltipla/Workflow provavelmente falha em produção porque depende da coluna `cargo` em `empresa_profissionais`, que um comentário em `TaskForm.jsx` afirma ter sido removida do schema real; e a conversão de OS Simples em Workflow (`converter-os-para-complexa`) insere em `tarefas_micro` sem a coluna `funcao`, que é `NOT NULL` no schema lido.

---

## 8. Fluxo Completo do AutoPublisher (do nascimento ao permalink)

### Pontos de entrada mapeados

1. **Ingestão automática (RSS / "Radar")** — `ap.sources` → `ap-data-ingestion` (cron, `status='raw'`) → `ap-image-fetcher` (`ready_for_scoring`) → `ap-scoring-engine` (score **hardcoded em 5.0**, `scored`) → `ap-daily-feed-builder` (`selected`, aba Pendentes). "Radar Instagram" existe tecnicamente — `ap-data-ingestion` detecta URLs `instagram.com` e as redireciona para um proxy RSS não-oficial — mas **não há essa opção explícita na UI**, é um comportamento invisível para o operador.
2. **Manual, Admin** — botão "Nova Matéria" → `ArticleWizard.jsx` → `ap-employee-generator`.
3. **Manual/Link, Staff** — `?modal=employee-mode` → `ArticleForm.jsx` → mesma Edge Function. Staff **nunca vê** o funil de revisão/aprovação — só "Criar", "Meu Histórico", "Banco de Matérias".
4. **Banco de Matérias (backlog compartilhado)** — `NewsBacklogPanel.jsx` (componente bem reaproveitado entre Admin e Staff) → tabela própria `ap.news_backlog` (deliberadamente fora do pipeline até alguém "adotar" a pauta) → adoção via RPC compare-and-set → produção pré-preenchida.

### Da entrada à publicação

- **Render**: `ap-render-engine` (cron 1 min + chamada direta assíncrona), usa API externa **Placid**, grava `render_url`, muda para `pending_review`. Recuperação automática via `ap-render-recovery` (cron 30 min, até 3 tentativas).
- **Revisão**: não existe tela dedicada — é o próprio card na aba "Pendentes". Sem diff, sem comentário, sem histórico de versões da legenda. Só `role='admin'` revisa (nem `super_admin` está no array de roles aceitas da Edge Function de aprovação).
- **Aprovação**: botão "Aprovar" → `ap-content-production (approve_for_ig)`. Auto-aprovação por score existe (`system_config.auto_approve`), mas como o score é sempre 5.0 fixo, só funciona se o limiar configurado for ≤ 5 — senão fica silenciosamente inoperante.
- **Publicação — o achado mais grave da auditoria**: o botão "Publicar" faz apenas `UPDATE candidate_news SET status='posted'` direto do navegador. Não chama a Graph API, não seta `instagram_post_id`. O pipeline automático real existe (`ap-scheduler` computa horário e status `queued_for_posting`; `ap-instagram-publisher` publicaria de fato via Graph API) mas **`ap-scheduler` nunca é invocado por nada no repositório**, e mesmo se fosse, produz um status que `ap-instagram-publisher` não consulta (ele busca `approved`, não `queued_for_posting`) — os dois workers são mutuamente incompatíveis mesmo em teoria. Na prática, o operador publica manualmente pelo Instagram e só "marca como feito" no sistema, sem qualquer verificação — por isso a coluna "IG"/permalink na aba Publicadas fica quase sempre vazia.
- **Histórico/permalink**: aba "Publicadas" (`status='posted'`), coluna `instagram_post_id` (raramente preenchida, ver acima). Staff só vê seu próprio histórico, sem visão do funil de aprovação/publicação.

### As 5 telas do AutoPublisher

| Tela | Rota | Função | Achado |
|---|---|---|---|
| `AutoPublisher.jsx` | `/admin/autopublisher` | Hub/funil (4 abas + backlog) | Botão "Processar Tudo" expõe reprocessamento manual de todo o pipeline automático na UI de produção |
| `AutoPublisherMonitoring.jsx` | — | Dashboard SRE completo (backlog por etapa, vazão, custo, erros), lendo views reais existentes | **BUG CRÍTICO — tela órfã, sem rota nem link em nenhum menu, inacessível** |
| `AutoPublisherSettings.jsx` | `/admin/autopublisher/settings` | 7 seções: Fontes, Motor de IA, Regras, RAG, Automação, Validação, Selos/patrocinadores | Seção "Motor de IA" é **single-tenant fixo** (`FIXED_CLIENT_ID` hardcoded), apesar do resto do produto ser multi-tenant |
| `AutoPublisherTemplates.jsx` | `/admin/autopublisher/templates` | Sistema de templates **legado** (Placid UUID editável na UI) | Coexiste com o sistema "master_v1" atual, configurável só via banco — dois sistemas de render paralelos sem indicação na UI de qual está ativo |
| `AutoPublisherMasterV1Settings.jsx` | dentro de Settings → "artes" | Selos e patrocinadores do sistema atual | Enterrada 2 cliques dentro de Configurações, embora seja onde a maior parte da operação visual real acontece |

### Matriz de status (AutoPublisher) — 13 valores mapeados para 4 abas

`raw → ready_for_scoring → scored → selected → processing → pending_render → pending_review → approved → (queued_for_posting, morto) → posted`, mais `failed`, `rejected`, e dois status mortos (`studio_selected`, `studio_ready`, produzidos por uma Edge Function stub — `ap-send-to-studio` só faz `console.log`+`setTimeout`, sem integração real).

Problemas de mapeamento encontrados: `processing` aparece na aba **Aprovadas** (não é aprovado); `failed`/`rejected` aparecem misturados na aba **Coletadas** junto com itens que ainda nem foram processados — semanticamente confuso ("rejeitado" ≠ "recém-chegado"). O rótulo "Pronta" é usado tanto para `pending_review` quanto para `approved`, ambos etapas distintas do funil.

### Validação da hipótese do briefing

A hipótese ("Entrou → Trabalhando → Revisar → Pronto → Publicado") **se confirma parcialmente** no nível das 4 abas (bom resumo já existe), mas **não** no nível dos badges/textos individuais dentro de cada aba, que seguem vazando a máquina de estados interna (13 status técnicos, nomes como "IA Gerando" para uma etapa que não envolve IA real). Staff e Admin, além disso, vivem em **duas experiências arquiteturalmente distintas** do mesmo pipeline (hub com abas vs. modal com 3 abas próprias) — não é uma variação de permissão da mesma tela, é outro produto.

### Descartar pauta quebrado

**BUG CRÍTICO ENCONTRADO — NÃO ALTERADO**: o botão "Descartar" no Banco de Matérias chama a RPC `ap.discard_news_backlog_item`, que **não existe em nenhuma migration do repositório**. O clique deve falhar com um erro genérico ("Não foi possível descartar esta pauta"), sem indicar que é uma função de backend ausente — e o estado `archived` do backlog fica, na prática, inatingível.

---

## 9. Matriz de Status Consolidada (todos os domínios)

| Domínio | Status técnicos vazando pra UI | Duplicidade de nomenclatura | Status mortos/inatingíveis |
|---|---|---|---|
| Tarefas/OS | `bloqueada`, `devolvida` aparecem crus em alguns lugares (`mt.status.replace('_',' ')` no cabeçalho de `MacroTaskDetail.jsx`) | `priority`(EN)/`prioridade`(PT); `notificacoes`(PT)/`notifications`(EN) | `pending`/`completed` (inglês, só usados por código morto/legado) |
| AutoPublisher | 13 valores de `status` mapeados para 4 abas; nomes como "processing"/"pending_render" refletidos em textos como "IA Gerando"/"Renderizando" | "Pronta" usado para dois status distintos (`pending_review` e `approved`) | `queued_for_posting` (produzido por função nunca chamada), `studio_selected`/`studio_ready` (produzidos por stub), `pending_production` (no CHECK constraint, sem produtor) |
| News Backlog | `available`/`adopted`/`archived` — razoavelmente limpo | — | `archived` inatingível (RPC de descarte ausente) |

**Padrão recorrente identificado**: em pelo menos dois domínios independentes (tarefas e notificações) existe uma dupla de colunas/tabelas EN/PT para o mesmo conceito, com partes do sistema lendo/escrevendo em lados diferentes da dupla. Isso não é coincidência de um único bug — é um padrão de dívida técnica que vale investigar de forma ampla (grep por outras duplas EN/PT no schema) antes de qualquer redesign de UI que dependa desses campos.

---

## 10. Encontrabilidade ("Para onde foi?")

| Ação | Onde aparece depois | Problema |
|---|---|---|
| Criou OS Workflow | Lista do Admin; etapas na lista de cada Staff | Não aparece em `staff/Today.jsx` (não preenche `assigned_to`) |
| Concluiu tarefa (Staff) | — | Some imediatamente do filtro padrão "Tudo" (que exclui concluídas), sem aviso |
| Devolveu etapa | — | Ação nunca completa (Edge Function com nome errado) |
| Prazo alterado | — | Não passa pela Edge Function `alterar-prazo-os`; não gera evento auditável nem aparece na Timeline do Staff |
| Excluiu tarefa/OS | Some da lista | Hard delete direto, sem auditoria, arquivos órfãos no Storage |
| Matéria rejeitada/falhou (AutoPublisher) | Aba "Coletadas" | Fica misturada com itens ainda não processados, sem ação de retry na UI |
| Matéria publicada | Aba "Publicadas" | Link do Instagram quase sempre vazio (publicação real é manual e não verificada) |
| Descartou pauta do backlog | — | Não some — a RPC não existe, o item permanece, só aparece um erro genérico |
| Notificação de tarefa | Sino de notificações | Nunca pode ser marcada como lida de fato (tabela errada) |

---

## 11. Admin × Staff — Comparação por Módulo

| Módulo | Admin | Staff | Avaliação |
|---|---|---|---|
| Dashboard | KPIs globais + feed em tempo real | KPIs pessoais + produtividade | Propósitos parecidos, zero reuso de componente entre os dois |
| Clique em card de tarefa (dashboard) | Abre modal inline | Navega para outra tela (perde contexto) | Inconsistência de padrão não justificada por permissão |
| Calendar | Vê tudo, modal com campo Empresa | Vê só o próprio | Diferença correta, mas os dois modais de detalhe são cópias quase idênticas |
| Meetings | CRUD completo | Somente leitura + confirmar presença | Correto |
| Assistentes/Conteúdo | CRUD, sem filtrar `ativo` | Somente leitura, filtra `ativo=true` | Admin pode estar vendo lista diferente da que o Staff vê, sem sinalização |
| AutoPublisher | Hub completo com funil de 4 abas + Settings/Templates | Modal isolado (Criar/Histórico/Backlog), sem visão do funil de revisão/aprovação | Duas experiências arquiteturalmente distintas do mesmo pipeline, não uma variação de permissão |
| Perfil | Componente reaproveitado nas 3 áreas (Admin/Staff/Super Admin) | idem | Bom exemplo de reuso a seguir |
| "Empresas" | Clientes operacionais do tenant | (Super Admin usa o mesmo rótulo para tenants da plataforma) | Termo sobrecarregado — risco de confusão para quem acessa mais de uma área |

---

## 12. Loaders e Processamento Assíncrono

- **Padrão dominante inconsistente**: convivem `SkeletonCard`/`SkeletonTable`/`SkeletonList`, spinners manuais (`div` com `animate-spin`) e um `LoadingScreen` — pelo menos 3 estilos de loading distintos no mesmo produto, incluindo JSX de spinner duplicado (não compartilhado) entre `RoleProtectedRoute` e `StrictSuperAdminRoute`.
- **Admin Dashboard**: qualquer "refresh silencioso" ainda remonta os 4 skeletons por inteiro, mais bloqueante do que precisaria.
- **`staff/Dashboard.jsx`**: tem um `catch {}` vazio (comentário "Error handled silently") — se a query falhar, o dashboard fica com dados zerados sem explicar por quê.
- **Mensagens de erro técnicas vazando**: `Reports.jsx` ("Verifique se as migrations foram aplicadas"), `Areas.jsx` (mensagem crua do Postgres) — expõem infraestrutura ao usuário final.
- **Domínio de Tarefas**: criação de OS Workflow é síncrona e bloqueante dentro de uma única requisição HTTP (loop de inserts); upload de anexos bloqueia o submit do formulário inteiro, sem opção de "criar e enviar depois".
- **Domínio AutoPublisher — o mais bem resolvido tecnicamente do produto**: render usa Realtime (Postgres Changes para Admin, canal broadcast dedicado + polling de fallback para Staff) para atualizar a UI sem refresh manual — mecanismo genuinamente funcional. Mas a UI comunica um tempo fixo ("~15s") quando o backend tolera até 60s de polling, e não há barra de progresso real — risco do operador achar que travou.
- **Notificações pré-prazo** (`scheduler-deadline-notifications`) só cobrem `tarefas_micro` — tarefas simples/legadas nunca recebem lembrete antes do atraso, só depois.

---

## 13. Dívida de UX — Lista Classificada

| # | Problema | Impacto | Tipo | Frequência | Evidência |
|---|---|---|---|---|---|
| 1 | Publicação no Instagram é manual e não verificada; pipeline automático incompatível internamente | **Crítico** | correção funcional / confiança | constante (todo item publicado) | `AutoPublisher.jsx` `handlePublish`; `ap-scheduler`, `ap-instagram-publisher` |
| 2 | "Solicitar Ajuste" (devolver tarefa) quebrado por nome de função divergente | **Crítico** | correção funcional | frequente (qualquer devolução) | `staff/Tasks.jsx`, `return-micro-tasks` |
| 3 | Notificações nunca marcáveis como lidas (tabela errada) | **Crítico** | feedback | constante | `NotificationCenter.jsx` |
| 4 | RPC de descarte de pauta inexistente | **Crítico** | correção funcional | frequente (uso do Banco de Matérias) | `NewsBacklogPanel.jsx` |
| 5 | `AutoPublisherMonitoring.jsx` órfão (sem rota/link) | **Alto** | navegação / arquitetura de informação | constante (feature inteira inacessível) | `App.jsx`, `Sidebar.jsx` |
| 6 | Exclusão de OS ignora Edge Function dedicada, perde auditoria, gera arquivos órfãos | **Alto** | arquitetura / risco de dados | frequente | `admin/Tasks.jsx`, `staff/Tasks.jsx`, `excluir-os` |
| 7 | Nenhum LLM roda na produção real de conteúdo (Motor de IA configurável mas não usado) | **Alto** | encontrabilidade / confiança | constante | `_shared/editorialWorkflow.ts` não importado por nenhum worker real |
| 8 | Duplicação Admin/Staff do fluxo "Nova Matéria" (wizard × form), lógica de validação duplicada | **Alto** | redundância / consistência | constante | `ArticleWizard.jsx` × `ArticleForm.jsx` |
| 9 | 4 padrões distintos de implementação de modal | **Alto** | consistência | constante | ver §5 |
| 10 | Ação destrutiva de maior impacto (suspender tenant) sem confirmação | **Alto** | permissão / segurança de interação | rara mas grave | `TenantDetail.jsx` |
| 11 | Duas colunas EN/PT paralelas para prioridade e notificações | **Alto** | consistência / arquitetura de dados | constante | schema `tarefas`, tabelas `notificacoes`/`notifications` |
| 12 | 3 tabelas de histórico não unificadas — Admin e Staff veem históricos diferentes da mesma OS | **Alto** | encontrabilidade / consistência | frequente | `os_timeline_view`, `MacroTaskDetail.jsx` |
| 13 | Rotas órfãs de navegação (`/admin/areas`, `/staff/today`, `/admin/professionals/:id/edit`) | Médio | navegação | constante | ver §3 |
| 14 | Toggle decorativo em Areas (não faz nada) | Médio | feedback / confiança | ocasional | `Areas.jsx` |
| 15 | Score de conteúdo hardcoded (5.0) — auto-aprovação por score inoperante na prática | Médio | encontrabilidade | constante | `ap-scoring-engine` |
| 16 | Settings "Motor de IA" single-tenant fixo apesar do produto ser multi-tenant | Médio | arquitetura | constante | `FIXED_CLIENT_ID` |
| 17 | 13 status técnicos do AutoPublisher mapeados para 4 abas, mas badges individuais vazam nomenclatura interna | Médio | carga cognitiva / linguagem | constante | `StatusBadge`, `STATUS_TAB` |
| 18 | Itens rejeitados/falhos misturados com itens recém-coletados na mesma aba | Médio | carga cognitiva | frequente | `AutoPublisher.jsx` |
| 19 | Termo "Empresas" sobrecarregado (Admin × Super Admin) | Médio | linguagem / arquitetura de informação | constante | — |
| 20 | Dois sistemas de configuração de render paralelos (Templates legado × master_v1) sem indicação de qual está ativo | Médio | arquitetura de informação | ocasional | `AutoPublisherTemplates.jsx`, `MasterV1Settings.jsx` |
| 21 | Bugs cosméticos de template string com espaços (classe CSS, rota morta) | Baixo | visual / código morto | rara | `Companies.jsx`, `CompanyDetails.jsx` |
| 22 | Textos de botão primário de ações destrutivas inconsistentes | Baixo | linguagem | frequente | vários modais de confirmação |
| 23 | Tempo de render comunicado como fixo ("~15s") quando pode levar até 60s | Baixo | feedback | ocasional | `AutoPublisher.jsx`, `EmployeeMode.jsx` |
| 24 | Código morto acumulado (componentes órfãos, funções de serviço não usadas, Edge Function `ap-send-to-studio` stub, `create-microtasks` gravando em tabela inexistente) | Baixo (hoje) / risco futuro | dívida técnica | — | ver §14 |

---

## 14. Redundâncias (consolidado)

- **Telas com função semelhante**: `Reports.jsx` (admin) × `ReportsPage.jsx` (super admin) × `SuperAdminDashboard.jsx` mostram métricas sobrepostas vindas de fontes diferentes (RPC dedicada vs. fetch cru + cálculo client-side).
- **AutoPublisherTemplates × AutoPublisherMasterV1Settings**: dois sistemas de configuração de render coexistindo para o mesmo conceito ("qual arte é gerada").
- **ArticleWizard × ArticleForm**: mesma finalidade (criar matéria), duas implementações.
- **TaskDetailModal × StaffTaskDetailModal**: ~190 linhas cada, quase idênticos.
- **AccountBlockedScreen × Suspended.jsx**: mesma mensagem, um em uso, outro morto.
- **`os_eventos` × `logs_tarefas` × `tarefas_micro_logs`**: três fontes de histórico não unificadas.
- **`notificacoes` × `notifications`**: duas tabelas de notificação.
- **`tarefas_micro` × `tarefas_itens`**: uma ativa, outra usada só por uma Edge Function morta (`create-microtasks`) que grava numa tabela que nem existe no schema lido.
- **Componentes órfãos** (não importados em lugar nenhum): `MicroTasksList.jsx`, `MicroTaskTimeline.jsx`, `MasterConfigsManager.jsx`.
- **"Empresas"** com dois significados de negócio diferentes entre Admin e Super Admin.

---

## 15. Arquitetura de Informação Atual

A navegação principal (Sidebar/rotas) é majoritariamente estruturada por **módulo técnico/entidade de banco** (Tarefas, Calendário, Empresas, Assistentes, AutoPublisher) mais do que por intenção do usuário — o que é razoável no nível 1 de navegação. O problema mais sério não está nesse nível, e sim **dentro** de cada módulo: as telas do AutoPublisher e o vocabulário de status de Tarefas/OS refletem quase diretamente a máquina de estados do backend (13 valores de status, nomes de Edge Function ecoando em textos de UI como "Renderizando"/"IA Gerando"/"Processar Tudo"). Isso é o padrão descrito no briefing como **arquitetura de software apresentada como arquitetura de produto** — confirmado com evidência concreta em ambos os domínios auditados em profundidade.

Casos concretos:
- O funil do AutoPublisher em 4 abas (Coletadas/Pendentes/Aprovadas/Publicadas) já é uma boa simplificação no nível da aba — mas os badges dentro de cada aba não seguem a mesma simplificação.
- Staff e Admin têm duas experiências **arquiteturalmente diferentes** do AutoPublisher (hub com funil vs. modal com 3 abas), não uma mesma tela com permissões diferentes — o que dificulta manter os dois em paridade ao longo do tempo (como já demonstrado pela duplicação Wizard/Form).
- "Configurações" do AutoPublisher mistura o que é realmente configuração de negócio (regras editoriais, fontes) com o que é debug/observabilidade técnica (Validação, que na prática é o único lugar que testa o LLM de verdade).

---

## 16. Modelo Mental Proposto (conceitual — não validado com usuários, só contra o código)

Com base no que foi encontrado, dois modelos mentais separados fazem sentido — um para o produto como um todo, outro específico para o AutoPublisher:

**Produto geral**, em vez de navegação por entidade técnica:
- **Meu Trabalho** (tarefas atribuídas a mim, o que preciso fazer agora — une Dashboard pessoal + Tarefas + Hoje, hoje fragmentados)
- **Conteúdo** (tudo relacionado a matérias/AutoPublisher, unificando a visão de Admin e Staff sobre o mesmo pipeline, com profundidade condicionada a permissão, não a telas inteiras diferentes)
- **Operação** (Calendário, Reuniões, Empresas/Equipe — o que hoje está espalhado em itens de menu irmãos sem agrupamento)
- **Histórico** (onde qualquer coisa concluída/publicada/arquivada pode ser encontrada de forma consistente — hoje esse "onde foi parar" é o ponto mais frágil identificado em toda a auditoria)
- **Configurações** (só para quem precisa — Admin/Super Admin)

**AutoPublisher especificamente**, a hipótese do briefing se sustenta **desde que a complexidade fique de fato só no backend**:

`Entrada → Em produção → Revisar → Pronto → Publicado`

Mapeamento validado contra os 13 status reais: `raw/ready_for_scoring/scored/selected` → **Entrada**; `processing/pending_render` → **Em produção**; `pending_review` → **Revisar**; `approved` → **Pronto**; `posted` → **Publicado**. `failed`/`rejected` precisam de um estado humano próprio ("Precisa de atenção"), não devem ficar escondidos dentro de "Entrada" como hoje. Os status mortos (`queued_for_posting`, `studio_selected`, `studio_ready`, `pending_production`) não deveriam aparecer em nenhum modelo até que (ou se) os sistemas que os produzem forem de fato conectados — ver §21.

---

## 17. O que Pode Ser Escondido (progressive disclosure — classificação, sem remover nada ainda)

| Elemento | Classificação | Justificativa |
|---|---|---|
| 4 abas do funil AutoPublisher, botões Aprovar/Publicar/Editar | Sempre visível | núcleo da tarefa principal do Admin |
| "Meu Histórico"/"Banco de Matérias" (Staff) | Sempre visível | núcleo da tarefa principal do Staff |
| Filtros de período em Relatórios, busca por nome | Sob demanda | úteis, não centrais |
| Configurações de Motor de IA, Regras, RAG | Avançado | hoje já em "Configurações", correto — mas deveria deixar claro que hoje não afeta conteúdo real (achado #7) |
| Botão "Processar Tudo" (reprocessar pipeline inteiro) | Técnico — não deveria estar na UI de operação diária | é uma ferramenta de debug/operação de sistema |
| `AutoPublisherMonitoring.jsx` | Técnico | dashboard de observabilidade, não é ferramenta de trabalho do operador — mas precisa de *algum* link (hoje é inacessível, não é "escondido de propósito") |
| Status `processing` exibido como "IA Gerando"; nomes de Edge Function em toasts | Técnico — candidato a reescrita de texto | vaza infraestrutura sem necessidade |
| Toggle Ativo/Inativo em Areas | Candidato a remoção (ou implementação real) | não faz nada hoje |
| `Suspended.jsx`, `TaskForm.jsx.backup`, `MicroTasksList.jsx`, `MicroTaskTimeline.jsx`, `taskService.createTask/createOS`, `create-microtasks`, `ap-send-to-studio` | Candidato a remoção | código morto confirmado, sem uso ativo |
| Aba "Por Cargo" (lógica pronta, nunca renderizada) em Reports | Candidato a remoção ou finalização | decisão pendente: acabar ou remover |

---

## 18. AutoPublisher Simplificado — Proposta Conceitual (sem implementação)

1. **Antes de qualquer simplificação de UI**, decidir o destino dos 3 sistemas incompletos encontrados: (a) publicação automática (`ap-scheduler`/`ap-instagram-publisher`) — terminar de conectar ou remover o código morto e assumir que publicação é manual por design; (b) motor de IA real — conectar `runEditorialWorkflow` ao caminho de produção ou remover a tela de configuração que hoje não tem efeito; (c) `ap-send-to-studio`/status `studio_*` — implementar de verdade ou remover.
2. **Colapsar o vocabulário de status** visível ao operador para os 5 estados humanos do §16, mantendo os 13 valores técnicos só no backend — isso é uma mudança de camada de apresentação (mapeamento de texto/cor), não precisa alterar o schema.
3. **Dar um estado próprio e visível para `failed`/`rejected`** ("Precisa de atenção"), com ação de retry manual na UI em vez de depender só do cron de recovery.
4. **Unificar Admin e Staff em um único fluxo de criação de matéria**, parametrizado por role/permissão em vez de dois componentes (`ArticleWizard`/`ArticleForm`) com lógica duplicada — Staff continuaria sem ver o funil de aprovação, mas usaria o mesmo motor de formulário.
5. **Mover "Processar Tudo" e qualquer outra ferramenta de debug** para uma área claramente marcada como avançada/técnica, fora do fluxo operacional diário.
6. **Conectar ou aposentar `AutoPublisherMonitoring.jsx`** — hoje é trabalho pronto sem uso.

---

## 19. Tarefas Simplificadas — Proposta Conceitual (sem implementação)

1. **Corrigir primeiro os bugs que quebram promessas feitas ao usuário** (devolver etapa, notificações, exclusão auditável) antes de qualquer redesign — um redesign bonito sobre fluxos quebrados pioraria a percepção de confiabilidade.
2. **Resolver a duplicidade `priority`/`prioridade`** e `notificacoes`/`notifications` — escolher uma coluna canônica e migrar, ou ao menos documentar qual é a fonte de verdade e ajustar as telas que leem a errada.
3. **Reduzir o formulário único e longo de criação de OS** para um fluxo em etapas (destino → detalhes → distribuição), adiando decisões de workflow/etapas para depois de salvar o essencial (título, empresa, prazo).
4. **Unificar as 3 fontes de histórico** (`os_eventos`, `logs_tarefas`, `tarefas_micro_logs`) numa única visão, para que Admin e Staff vejam a mesma linha do tempo da mesma OS.
5. **Adicionar um feedback explícito** quando uma tarefa concluída sai do filtro padrão ("Movida para Concluídas"), em vez de simplesmente desaparecer.
6. **Reavaliar a existência de `staff/Today.jsx`** — é uma tela pronta e potencialmente útil, mas hoje inacessível e com um bug de schema próprio; decidir se entra na navegação (corrigindo o bug) ou é removida.

---

## 20. Quick Wins (recomendações apenas — nada executado)

Ordenados por relação impacto/esforço, todos com risco baixo de regressão por serem correções pontuais e não mudanças de contrato:

1. Corrigir o nome da função chamada em "Solicitar Ajuste" (`return-micro-task` → `return-micro-tasks`).
2. Corrigir `NotificationCenter.jsx` para marcar como lida/limpar na tabela `notifications` (EN), que é onde tudo é gravado.
3. Adicionar rota + item de menu (ainda que em área "avançada"/admin-only) para `AutoPublisherMonitoring.jsx`.
4. Criar a RPC `ap.discard_news_backlog_item` que falta (ou trocar a chamada do frontend pela RPC correta, se ela existir sob outro nome em produção — validar primeiro).
5. Corrigir os dois bugs de template string com espaços (`Companies.jsx` rota morta, `CompanyDetails.jsx` classe CSS).
6. Padronizar o texto do botão primário em modais de confirmação destrutiva.
7. Adicionar modal de confirmação em "SUSPENDER ACESSO" (Super Admin).
8. Implementar de verdade ou remover o toggle Ativo/Inativo de `Areas.jsx`.
9. Remover código morto de baixo risco já identificado (`Suspended.jsx`, `TaskForm.jsx.backup`, componentes órfãos) — após confirmar com o usuário que não há dependência oculta.
10. Renomear textos técnicos visíveis ("IA Gerando" → algo que não implique geração de IA que não ocorre; tempo de render "~15s" → uma faixa realista ou indicador de progresso genuíno).

---

## 21. Mudanças Estruturais Posteriores (recomendações — não executar agora)

1. **Decidir o destino do pipeline de publicação automática do Instagram**: terminar a integração (`ap-scheduler` → `ap-instagram-publisher`, alinhando os status que cada um usa) ou removê-lo formalmente e documentar que a publicação é manual por design.
2. **Decidir o destino do Motor de IA configurável**: conectar de fato ao caminho de produção (`runEditorialWorkflow`) ou simplificar a tela de Configurações para não sugerir uma capacidade que não existe hoje.
3. **Unificar o sistema de modal** em torno do componente oficial `ui/Modal.jsx`, migrando os padrões hand-rolled/inline gradualmente.
4. **Unificar a criação de matéria** Admin/Staff num único componente parametrizado.
5. **Unificar as fontes de histórico de tarefas** numa única tabela/view consumida por todas as telas.
6. **Resolver a duplicidade EN/PT** de colunas de prioridade e tabelas de notificação — decisão de schema, não só de UI.
7. **Decidir o futuro dos dois sistemas de template de render** (legado × master_v1) — sinalizar na UI qual está ativo, ou aposentar um dos dois.
8. **Repensar a navegação de alto nível** em torno do modelo mental proposto (§16), mantendo compatibilidade com URLs/rotas existentes para não quebrar links salvos/compartilhados.

---

## 22. Riscos — Classificação por Tipo de Mudança Futura

| Mudança proposta | UI-only | Frontend+backend | Alteração de contrato | Migration | Risco de regressão | Risco a dados históricos |
|---|---|---|---|---|---|---|
| Colapsar vocabulário de status em texto/cor (AutoPublisher, Tarefas) | Sim | Não | Não | Não | Baixo | Nenhum |
| Corrigir nome de função (`return-micro-task(s)`) | Não | Sim (frontend) | Não | Não | Baixo | Nenhum |
| Corrigir tabela de notificações lidas | Não | Sim (frontend) | Não | Não | Baixo — mas validar volume de notificações "presas" já acumuladas | Nenhum |
| Criar RPC de descarte de pauta | Não | Sim (backend) | Sim (nova RPC) | Sim (migration) | Baixo | Nenhum |
| Unificar sistema de modal | Sim (majoritariamente) | Pontualmente | Não | Não | Médio — muitos pontos de contato, testar cada modal migrado | Nenhum |
| Unificar criação de matéria Admin/Staff | Não | Sim | Possível (payload) | Talvez | Médio-Alto — é o fluxo mais usado do AutoPublisher | Baixo (não altera dados existentes) |
| Resolver duplicidade `priority`/`prioridade` | Não | Sim | Sim | Sim | Alto se feito sem cuidado — precisa decidir coluna canônica e migrar dados existentes | **Alto** — dados de prioridade histórica podem estar só numa das colunas |
| Unificar histórico de tarefas (3 tabelas → 1 view) | Sim (se só a view mudar) | Possível | Possível | Possível | Médio | Baixo se for só união de leitura, sem apagar tabelas de origem |
| Conectar pipeline de publicação automática | Não | Sim | Sim | Talvez | **Alto** — é publicação real em rede social, erro afeta a marca do cliente publicamente | Nenhum diretamente, mas erro de publicação é irreversível externamente |
| Conectar Motor de IA real ao caminho de produção | Não | Sim | Sim | Não necessariamente | **Alto** — muda o conteúdo publicado de fato, precisa de validação editorial cuidadosa | Nenhum |
| Reorganizar navegação de alto nível (modelo mental) | Sim | Não necessariamente | Não | Não | Médio — treinar usuários existentes, cuidado com links/atalhos salvos | Nenhum |

**Lembrete transversal**: como o produto não tem staging (só produção), **toda migration ou mudança de contrato deve ser tratada com o cuidado máximo** — idealmente validando primeiro contra uma cópia/branch do banco antes de aplicar, e sempre em coordenação explícita com o usuário antes de qualquer `apply_migration`.

---

## 23. Plano de Evolução Sugerido (fases pequenas e seguras)

**Fase 0 — Correções funcionais, não é redesign** (antes de qualquer mudança de UX visível): corrigir os 4 bugs críticos (§13 #1-4) que fazem o sistema mentir sobre o que aconteceu (devolver tarefa, notificação lida, descarte de pauta, e decidir conscientemente sobre publicação manual vs. automática). Sem isso, qualquer redesign posterior herda uma base que não cumpre o que promete.

**Fase 1 — Quick wins de baixo risco** (§20): correções pontuais de bug, navegação órfã, textos técnicos, confirmações destrutivas padronizadas. Nenhuma mudança de contrato/schema.

**Fase 2 — Consolidação de padrões existentes, sem mudar comportamento**: migrar modais para o componente oficial; unir os dois modais de detalhe de tarefa (Admin/Staff) num componente parametrizado; unificar badges de status reutilizando os mesmos componentes entre Admin e Staff.

**Fase 3 — Camada de apresentação de status** (mapeamento visual, não muda schema): introduzir o vocabulário humano de 5 estados (§16) como camada sobre os status técnicos existentes, tanto em Tarefas quanto no AutoPublisher.

**Fase 4 — Decisões de arquitetura pendentes** (§21, cada uma isolada e validada com o usuário antes de executar): destino do pipeline de publicação automática; destino do Motor de IA; resolução da duplicidade `priority`/`prioridade` e `notificacoes`/`notifications`; futuro do sistema de templates legado.

**Fase 5 — Unificação de fluxos duplicados**: um único fluxo de criação de matéria (Admin/Staff); uma única fonte de histórico de tarefas.

**Fase 6 — Reorganização da navegação de alto nível** em torno do modelo mental proposto, só depois que as fases anteriores já tiverem removido as inconsistências que hoje tornariam essa reorganização confusa.

Cada fase deve ser tratada como entregas independentes e revisáveis — nenhuma delas depende estritamente da anterior estar 100% completa, mas a ordem acima minimiza o risco de construir sobre uma base que ainda mente sobre o que faz.

---

## Anexo — Arquivos-chave citados nesta auditoria

`src/App.jsx`, `src/config/navigation.js`, `src/layout/{Sidebar,BottomNav,Header,AppLayout,AdminLayout,StaffLayout,SuperAdminLayout,FloatingActionButton}.jsx`, `src/routes/{ProtectedRoute,RoleProtectedRoute,StrictSuperAdminRoute}.jsx`, `src/pages/admin/**`, `src/pages/staff/**`, `src/pages/super-admin/**`, `src/pages/{Login,ResetPassword,Suspended}.jsx`, `src/components/{ui/Modal,EditTaskModal,MacroTaskDetail,ConversaoWorkflowModal,ReturnReasonModal,Timeline,NotificationCenter,AccountBlockedScreen,dashboard/*,editorial/*}.jsx`, `src/services/{taskService,operationalStatus,dashboardMetrics,masterRuntime,masterV1Assets,masterV1Availability,territorialComposer,visualModels,visualTitleGroups}.js`, `supabase/functions/{ap-*, create-os-by-function, converter-os-para-complexa, complete-micro-task, return-micro-tasks, alterar-prazo-os, excluir-os, notify-overdue-tasks, scheduler-deadline-notifications, create-microtasks, delete-task-attachment}/index.ts`, `supabase/functions/_shared/{canonicalEditorial.mjs, editorialWorkflow.ts, llmClient.ts}`, migrations relevantes citadas inline por seção.
