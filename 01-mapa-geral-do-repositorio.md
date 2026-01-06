# Mapa Geral do Repositório | TVG Flow
**Data de Geração:** 06/01/2026
**Autor:** Antigravity (IA Sênior Architect)
**Versão:** 1.0 (Auditado)

---

## 1. Visão Geral
*   **Tipo de Aplicação:** Single Page Application (SPA), evoluindo para Progressive Web App (PWA).
*   **Tech Stack:**
    *   **Core:** React 19 + Vite.
    *   **Linguagem:** JavaScript (ESNext).
    *   **Estilização:** CSS Modules + Variáveis Globais (Design Token System).
    *   **Backend as a Service:** Supabase (Auth, Postgres, Storage, Realtime).
    *   **Server Logic:** Supabase Edge Functions (Deno/TypeScript).
*   **Arquitetura:** Modular por Domínio (Admin/Staff), com RBAC (Role-Based Access Control) rígido no roteamento.

---

## 2. Estrutura de Pastas (Árvore Explicada)

### `/src` (O Código Fonte)
A raiz da aplicação. Aqui reside toda a lógica de frontend.

#### `/pages` (Camada de Visão)
Dividida estrategicamente por **perfil de acesso**:
*   `/pages/admin`: Onde vive o dashboard do gestor.
    *   `Tasks.jsx` (64KB - ⚠️): O "coração" do sistema. Monólito que gerencia o Kanban/Lista de tarefas.
    *   `Dashboard.jsx`: KPIs e gráficos.
    *   `professionals/`: Módulo isolado para gestão de equipe (CRUD).
*   `/pages/staff`: Visão simplificada para o operacional.
    *   `Tasks.jsx` (29KB): Versão "light" e focada apenas nas tarefas do usuário.
*   `/pages/super-admin`: Área de "Deus" (Gestão de Tenants/Empresas).

#### `/components` (Blocos de Construção)
Componentes reutilizáveis.
*   `/components/forms`: Formulários complexos (`TaskForm.jsx` - 26KB).
*   **Nota Arquitetural:** Estamos evitando bibliotecas de UI pesadas (MUI/AntD) em favor de CSS puro e Radix (implícito) para performance.

#### `/contexts` (Estado Global)
*   **`AuthContext.jsx`**: O guardião. Gerencia sessão, login, logout e *refresh token*. É o arquivo mais crítico para a segurança.
*   **`InAppNotificationContext.jsx`**: Gerencia o sininho de notificações em tempo real.

#### `/services` (Camada de Dados)
Isolamento total da comunicação com o Supabase.
*   `supabase.js`: Cliente Singleton.
*   `taskService.js`, `professionals.js`: Abstraem as queries SQL/RPC. A UI não deve chamar `supabase.from()` diretamente, apenas usar estes services.

#### `/hooks` (Lógica Reutilizável)
*   `useAppVisibility.js`: Detecta se a aba está focada (útil para pausar updates em background).

#### `/styles` (Design System)
*   `tokens.css`: A "bíblia" de cores, fontes e espaçamentos.
*   `reset.css`, `base.css`: Normalização para garantir consistência entre browsers.

### `/supabase` (Backend Declarativo)
*   `/functions`: **Edge Functions** (Deno). Código server-side que roda na borda.
    *   Ex: `send-push-notification`, `delete-professional`.
*   `/migrations`: Histórico evolutivo do banco de dados (SQL).

### `/public` (Assets Estáticos)
*   `manifest.json`: Configuração do PWA (nome, ícones, cores do app instalado).
*   `push-sw.js`: Service Worker específico para Push Notifications.

---

## 3. Arquivos Críticos (Onde Tudo Começa)

1.  **`src/main.jsx`**: O ponto de entrada.
    *   Envolve a app em `AuthProvider`.
    *   Implementa `hardenConsole()` (remove logs em produção).
2.  **`src/App.jsx`**: O roteador.
    *   Define quem acessa o quê (`RoleProtectedRoute`).
    *   Separa layouts (`AdminLayout`, `AppLayout`).
3.  **`vite.config.js`**: A configuração do Build.
    *   Configura o PWA (`vite-plugin-pwa`).
    *   Remove `console.log` no build final via `esbuild`.

---

## 4. Pontos de Atenção (Análise Sênior)

### 🔴 Alta Complexidade (Monólitos)
Arquivos que cresceram demais e precisam de refatoração futura (quebra em sub-componentes):
1.  **`src/pages/admin/Tasks.jsx` (64KB):**
    *   *Risco:* Contém lógica de filtro, renderização de Kanban, Lista e Drag-and-Drop misturados.
    *   *Sugestão:* Mover filtros para `TaskFilters.jsx` e cards para `TaskCard.jsx`.
2.  **`src/pages/admin/CompanyDetails.jsx` (26KB):**
    *   Acumula gestão de dados da empresa + lista de funcionários + tabs.

### 🟡 Acoplamento de Formulários
*   **`src/components/forms/TaskForm.jsx` (26KB):**
    *   Este formulário sabe "demais". Ele lida com criação, edição, validação complexa e até regras de negócio de datas. Ideal seria extrair validações para um hook `useTaskValidation`.

### 🟢 Dívidas Técnicas (Tech Debt)
*   **Service Worker em Dev:** O SW está desabilitado em desenvolvimento (`devOptions: { enabled: false }`) para evitar conflitos de Auth. Isso é correto, mas exige testes manuais de PWA apenas em build/preview.
*   **Providers:** A árvore de providers em `App.jsx` está crescendo (`RefreshProvider`, `InAppNotificationProvider`). Considere um `AppProviders.jsx` para limpar o componente raiz.

---

*Documento gerado para orientação estratégica da equipe de desenvolvimento.*
