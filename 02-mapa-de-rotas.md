# Mapa de Rotas | TVG Flow
**Data de Geração:** 06/01/2026
**Autor:** Antigravity (Frontend Architect)
**Versão:** 1.0 (Auditado)

---

## 1. Visão Geral da Navegação
O sistema utiliza **React Router v6**. A navegação é estritamente segura, dividida em "mundos" isolados por permissão. Não há rotas híbridas (que aceitam ambos os papéis).

### Legenda de Risco
*   🟢 **Baixo:** Página estática ou de leitura simples.
*   🟡 **Médio:** Formulários ou dependência de IDs na URL.
*   🔴 **Crítico:** Core do sistema; falha aqui para a operação.

---

## 2. Rotas Públicas (Acesso Livre)
Nenhuma sessão necessária.

| Path | Componente | Risco | Descrição |
| :--- | :--- | :--- | :--- |
| `/login` | `Login` | 🔴 | Porta de entrada. Se falhar, ninguém acessa. Depende de Supabase Auth. |
| `/reset-password` | `ResetPassword` | 🟡 | Recuperação de acesso. |
| `/suspended` | `Suspended` | 🟢 | Tela estática para tenants/usuários bloqueados. |
| `/` | `Navigate` | 🟢 | Redireciona para `/login`. |

---

## 3. Módulo Admin (`/admin`)
🔒 **Proteção:** `ProtectedRoute` + `Role: 'admin'`

| Path | Componente | Risco | Possíveis Pontos de Falha |
| :--- | :--- | :--- | :--- |
| `/admin/dashboard` | `Dashboard` | 🟡 | Renderização de gráficos com dados nulos. |
| `/admin/tasks` | `Tasks` | 🔴 | Monólito de Kanban. Alto consumo de memória. |
| `/admin/tarefas/nova` | `NewOS` | 🟡 | Validação de formulário complexo. |
| `/admin/areas` | `Areas` | 🟢 | CRUD simples. Baixo risco. |
| `/admin/professionals` | `ProfessionalsList` | 🟡 | Listagem. Risco de paginação/filtro quebrar. |
| `/admin/professionals/:id/edit`| `ProfessionalEdit` | 🟡 | ID inválido na URL pode gerar tela branca se não tratado. |
| `/admin/companies` | `Companies` | 🟡 | Gestão de Tenants. Crítico para multitarefa. |
| `/admin/companies/:id` | `CompanyDetails` | 🔴 | Complexidade alta. Carrega muitos dados relacionais. |
| `/admin/calendar` | `Calendar` | 🟡 | Manipulação de datas/fuso horário. |
| `/admin/reports` | `Reports` | 🟢 | Apenas leitura. |

---

## 4. Módulo Staff (`/staff`)
🔒 **Proteção:** `ProtectedRoute` + `Role: 'profissional'`

| Path | Componente | Risco | Possíveis Pontos de Falha |
| :--- | :--- | :--- | :--- |
| `/staff/dashboard` | `StaffDashboard` | 🟡 | Depende de query rápida de "minhas tarefas". |
| `/staff/tasks` | `StaffTasks` | 🔴 | Ferramenta de trabalho diário do colaborador. |
| `/staff/today` | `StaffToday` | 🟡 | Lógica de data ("hoje") deve respeitar fuso horário. |
| `/staff/requests/new` | `StaffRequestCreate` | 🟢 | Formulário simples de solicitação. |
| `/staff/profile` | `StaffProfile` | 🟢 | Edição de dados básicos. |

---

## 5. Módulo Super Admin (`/platform`)
🔒 **Proteção:** `ProtectedRoute` + `SuperAdminRoute`
*Acesso restrito aos desenvolvedores/donos da plataforma.*

| Path | Componente | Risco | Descrição |
| :--- | :--- | :--- | :--- |
| `/platform` | `SuperAdminDashboard` | 🟢 | Visão macro do sistema. |
| `/platform/companies` | `TenantListPage` | 🔴 | Gestão de assinaturas dos clientes (SaaS). |
| `/platform/system` | `SystemStatusPage` | 🟢 | Monitoramento de saúde da API. |

---

## 6. Análise de Segurança & Integridade

### Pontos Fortes
1.  **Isolamento de Rotas:** É impossível um `staff` acessar `/admin/tasks` via URL direta. O `RoleProtectedRoute` intercepta e redireciona.
2.  **Fallback Seguro:** Rotas inexistentes não foram explicitamente mapeadas com um "404 Page", o que pode levar a um comportamento padrão do Router (tela branca ou erro). **Recomendação:** Criar rota `*` para 404.

### Pontos de Atenção
1.  **Deep Linking (`:id`):**
    *   Nas rotas `/admin/companies/:id` e `/admin/professionals/:id/edit`, o componente deve validar se o ID é um UUID válido e se existe no banco, antes de tentar renderizar. Caso contrário, a app pode "crashar" (Uncaught Error).
2.  **Performance:**
    *   `/admin/tasks` carrega todas as tarefas. Em um cenário com 10.000 tarefas, essa rota vai travar o navegador. Necessário implementar paginação no Backend (Server-side Pagination).

---

*Documento gerado para documentação de arquitetura de frontend.*
