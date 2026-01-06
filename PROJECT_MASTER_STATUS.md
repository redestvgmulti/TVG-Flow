# TVG Flow - Master Status Document (2026)

**Data de Atualização:** 06/01/2026
**Status Global:** 🟢 Estável / Em Otimização
**Versão:** 2.1 (Pós-Auditoria)

---

## 1. O Que É O Projeto (Visão Geral)
O **TVG Flow** é um Sistema Operacional de Gestão (SGO) completo para a agência TVG. Ele centraliza a operação, saindo de planilhas e processos manuais para uma plataforma digital unificada.
O sistema é dividido em dois grandes portais:
1.  **Admin (Gestão):** Visão completa para sócios e gerentes (Dashboards, Financeiro, RH, Supervisão de Tarefas).
2.  **Staff (Operacional):** Visão focada para o colaborador (Minhas Tarefas, Hoje, Solicitações).

---

## 2. O Que Já Fizemos (Progresso Real)

### 🏗️ Arquitetura & Core
*   **Frontend Refatorado:** Migração completa para React 19 + Vite. Estrutura de pastas limpa e modular.
*   **Design System "CityOS":** Implementação visual premium (Glassmorphism) praticamente completa.
*   **Segurança (RBAC):** Sistema de permissões robusto. Usuário "Staff" não acessa rotas de "Admin" e vice-versa.
*   **Sanitização:** O código foi auditado (06/01/2026). Arquivos lixo removidos. Nenhuma "Ponta solta" (dead code) crítica encontrada.

### 🚀 Módulos Funcionais
| Módulo | Status | Detalhes |
| :--- | :--- | :--- |
| **Autenticação** | ✅ Pronto | Login, Reset de Senha e Proteção de Rotas 100% funcionais. |
| **Profissionais** | ✅ Pronto | CRUD completo, Convites, Exclusão Segura e Listagem. Refatorado recentemente. |
| **Tarefas (OS)** | ✅ Pronto | Criação, Fluxo Profissional, Comentários e Anexos. Core do sistema operando. |
| **Dashboard Admin** | 🟡 Polimento | KPIs e Gráficos implementados, mas precisa de ajuste fino em Mobile. |
| **Dashboard Staff** | ✅ Pronto | Foco em "Minhas Tarefas do Dia". Simplificado e direto. |
| **Empresas (Tenants)** | ✅ Pronto | Gestão multitarefa preparada (estrutura pronta para escalar). |
| **Notificações** | ✅ Pronto | Sistema de Push e In-App implementado via Edge Functions. |

### ⚙️ Backend (Supabase)
*   **Banco de Dados:** Schema maduro com 69 migrações aplicadas.
*   **Edge Functions:** 15 Funções Serverless ativas (críticas para segurança e automação).
*   **Segurança RLS:** Políticas de segurança (Row Level Security) auditadas e corrigidas para evitar vazamento de dados entre empresas.

---

## 3. Pontos de Fraqueza & Atenção (Onde o bicho pega)

Aqui seremos brutalmente honestos sobre o que falta ou está frágil:

1.  **Dependência de Patches Manuais:** Temos muitas intervenções via SQL direto (`migrations` manuais). Precisamos garantir que o ambiente de produção esteja *exatamente* igual ao local.
2.  **Performance Mobile (Blur):** O efeito de vidro ("Glassmorphism") é lindo, mas pode travar celulares antigos (Androids low-end). Precisamos monitorar isso.
3.  **Testes Automatizados (Zero):** Não temos testes E2E (Cypress/Playwright). Se quebrarmos o login numa atualização, só vamos descobrir quando o usuário reclamar.
4.  **Onboarding de Usuário:** O fluxo de "Primeiro Acesso" é básico. O usuário cai no sistema sem um tour guiado.
5.  **Logs de Erro no Frontend:** Se o React quebra na cara do usuário, não temos um Sentry ou LogRocket reportando isso automaticamente.

---

## 4. O Que Precisamos Fazer (Roadmap Imediato)

### Prioridade 1: Estabilidade & Confiança
*   [ ] **Test Drive Final:** Simular um dia de trabalho completo (criar tarefa, finalizar, reabrir, comentar) para garantir que *nada* trava.
*   [ ] **Mobile Check:** Abrir o sistema em um iPhone e um Android médio para ajustar tamanhos de fonte e botões.

### Prioridade 2: Funcionalidades Faltantes
*   [ ] **Relatórios Avançados:** O módulo de relatórios existe mas é básico. Precisamos de filtros por data e exportação PDF/CSV real.
*   [ ] **Perfil do Usuário:** Permitir que o próprio usuário troque sua foto e senha facilmente (hoje é focado no admin).

### Prioridade 3: "Wow Factor" (Diferenciais)
*   [ ] **Modo Dark/Light:** O sistema é nativamente Dark/Glass. Verificar contraste para leitura diurna.
*   [ ] **Animações de Transição:** Suavizar a entrada e saída de páginas (Framer Motion já está instalado, usar mais).

---

## 5. Conclusão da Auditoria
O código está **saudável**. Não é um "espaguete". As bases são sólidas. O maior risco agora não é técnico, é de **usabilidade** e **polimento**. Precisamos parar de "codar novas features" e começar a "usar e refinar" o que já existe para garantir a experiência premium prometida.
