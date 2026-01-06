# Código Audit TVG Flow - Dezembro 2025

**Data de Atualização:** 18/12/2025
**Versão do Documento:** 2.0
**Status do Projeto:** Em Desenvolvimento Ativo / Estabilização

---

## 1. Visão Geral do Projeto

O **TVG Flow** é um Sistema de Gestão Operacional (SGO) customizado para a agência de marketing TVG. Ele atua como um centro de comando centralizado para controle de tarefas, prazos, produtividade da equipe e governança de áreas.

### Stack Tecnológica
*   **Frontend:** React 19, Vite, Tailwind (via CSS modules/tokens), Radix UI (implícito via componentes), Lucide React (ícones).
*   **Backend (BaaS):** Supabase (PostgreSQL, Auth, Realtime, Storage).
*   **Server-side:** Supabase Edge Functions (Deno/TypeScript) para operações privilegiadas.
*   **Hospedagem:** Vercel.
*   **Design System:** "CityOS" - Interface premium com Glassmorphism, gradientes e animações fluidas.

---

## 2. Estrutura e Arquitetura

A estrutura do projeto segue padrões modernos de React com separação clara de responsabilidades.

```
src/
├── assets/          # Recursos estáticos
├── components/      # Componentes UI reutilizáveis (Buttons, Cards, Modals)
├── contexts/        # Gerenciamento de estado global (AuthContext)
├── layout/          # Estruturas de página (Sidebar, Header, AppLayout)
├── pages/           # Telas da aplicação
│   ├── admin/       # Área administrativa (Dashboard, Tarefas, Profissionais)
│   ├── staff/       # Área do colaborador (Minhas Tarefas, Hoje)
│   └── auth/        # Login
├── routes/          # Definição de rotas e Proteção (RBAC)
├── services/        # Camada de API (Supabase Client)
├── styles/          # Design Tokens, Reset e Temas Globais
└── utils/           # Helpers e Formatadores
```

---

## 3. Auditoria de Funcionalidades e Status

### 3.1. Autenticação e Segurança
*   **Status:** ✅ Implementado e Estável.
*   **Detalhes:**
    *   Login via E-mail/Senha com Supabase Auth.
    *   Proteção de rotas (`ProtectedRoute`) para usuários não logados.
    *   Controle de Acesso Baseado em Função (`RoleProtectedRoute`) separando **Admin** de **Profissional**.
    *   **Correção Recente:** Fluxo de logout corrigido para garantir redirecionamento limpo para a home.

### 3.2. Dashboard Administrativo
*   **Status:** ⚠️ Em Polimento (Correção de Crash Recente).
*   **Features:**
    *   **KPIs:** Cards flutuantes com métricas chave (Tarefas, Atrasos, etc.).
    *   **Gráficos:** Visualização de desempenho usando `recharts`.
    *   **Lista de Tarefas:** Visão rápida de demandas recentes.
*   **Design:** Atualizado para o estilo "Glassmorphism" com sombras suaves e cards translúcidos.

### 3.3. Gestão de Profissionais
*   **Status:** ✅ Funcional com Melhorias Recentes.
*   **Features:**
    *   Listagem completa de colaboradores.
    *   Edição de perfil e permissões.
    *   **Exclusão Segura:** Implementada `Edge Function` para remoção completa (Auth + Tabela Pública) com confirmação de segurança na UI.

### 3.4. Gestão de Tarefas (Core)
*   **Status:** ✅ Funcional.
*   **Features:**
    *   Criação de tarefas com atribuição, prazo e prioridade.
    *   Kanban/Lista para visualização.
    *   Enriquecimento de tarefas com links (ex: Google Drive).
*   **Automação:** Sistema de identificação automática de atrasos (SLA 72h) via Banco de Dados/Cron.

### 3.5. Áreas e Governança
*   **Status:** ✅ Implementado.
*   **Features:**
    *   CRUD de Áreas/Departamentos.
    *   **Governança:** Políticas de RLS rigorosas implementadas para garantir que usuários vejam apenas o permitido.

---

## 4. Banco de Dados e Backend (Supabase)

### 4.1. Tabelas Principais
*   `public.profissionais`: Perfil estendido dos usuários (vinculado ao `auth.users`).
*   `public.tarefas`: Núcleo do sistema de demandas.
*   `public.areas`: Departamentos da agência.
*   `public.clientes`: Carteira de clientes.

### 4.2. Segurança (RLS - Row Level Security)
Uma auditoria recente de segurança reforçou as políticas:
*   **Políticas Implementadas:**
    *   `Enable read access for all authenticated users` (Leitura geral básica).
    *   `Enable insert/update/delete for admins` (Controle total para admins).
    *   Correção de recursão infinita em políticas de `areas` e `profissionais`.

### 4.3. Edge Functions
Edge Functions foram criadas para operações que exigem `service_role` (privilégio total) que não devem ser expostas no cliente:
*   `provision`: Criação segura de usuários admin.
*   `delete-user`: Remoção completa de contas de usuário e dados associados.
*   `send-push-notification`: Disparo de notificações push.

---

## 5. Design System "CityOS"

Um esforço significativo de refatoração visual foi realizado recentemente.

*   **Conceito:** Interface inspirada em sistemas operacionais premium (macOS/iOS).
*   **Elementos Chave:**
    *   **Glassmorphism:** Uso intensivo de `backdrop-filter: blur()` em Sidebars, Modais e Cards.
    *   **Tipografia:** Padronizada para `Inter`, com hierarquia clara.
    *   **Cores:** Paleta vibrante mas profissional, com suporte a gradientes "Aurora" no fundo.
    *   **Micro-interações:** Botões com estados de hover refinados e transições suaves.
*   **Arquitetura CSS:**
    *   `tokens.css`: Variáveis globais.
    *   `base.css`: Estilos fundamentais e background.
    *   `components.css`: Estilos de componentes complexos.
    *   `layout.css`: Estrutura de grid e posicionamento.

---

## 6. Histórico Recente de Intervenções

1.  **Correção de Crash no Dashboard:** Identificação e tratamento de erro de renderização no componente `Painel`.
2.  **Exclusão de Funcionários:** Implementação end-to-end (Front + Edge Function) para deletar usuários com segurança.
3.  **Refatoração Visual (CityOS):** Aplicação do novo Design System em toda a aplicação.
4.  **Correção de Rotas:** Ajuste no redirecionamento de Logout e rotas protegidas.
5.  **Correção de Timezones:** Ajuste no agendamento de tarefas para respeitar o fuso horário local (America/Sao_Paulo).

---

## 7. Próximos Passos Recomendados

1.  **Monitoramento:** Verificar logs da Edge Function de notificações para garantir entrega.
2.  **Testes:** Implementar testes automatizados para fluxos críticos (Login, Criação de Tarefa).
3.  **Performance:** Analisar o impacto dos efeitos de "Blur" em dispositivos mais antigos.
4.  **Mobile:** Refinar a experiência em telas pequenas (PWA), focando na responsividade do Dashboard.

---
*Documento gerado automaticamente pela IA Assistente Antigravity.*
