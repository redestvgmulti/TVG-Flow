# Backend & Auditoria de Segurança | TVG Flow
**Data de Geração:** 06/01/2026
**Autor:** Antigravity (Supabase Architect)
**Versão:** 1.0

---

## 🗄️ 1. Banco de Dados (Schema Public)

### Tabelas Principais (Core)
| Tabela | Responsabilidade | Risco de Dados |
| :--- | :--- | :--- |
| `public.profissionais` | Perfil estendido do usuário. Vincula `auth.users` à lógica da agência. | 🔴 Alto (PII: Email, Nome). |
| `public.empresas` | Tenants (Clientes da Agência). Define o escopo de acesso. | 🔴 Crítico. Isolamento entre clientes. |
| `public.tarefas` | Tabela central de operação. Milhares de registros previstos. | 🟡 Médio. Dados de negócio. |
| `public.tarefas_itens` | Micro-tarefas vinculadas à tarefa pai. | 🟢 Baixo. |
| `public.clientes` | Carteira de clientes (CRM básico). | 🟡 Médio. |

### Relacionamentos Críticos
*   **Tenant Isolation:** `empresa_id` é a Foreign Key mais importante. Se ela falhar ou for nula, um dado vaza para o limbo ou para todos.
*   **Auth Binding:** `user_id` em `profissionais` deve ser UNIQUE e 1:1 com `auth.users`.

---

## 🛡️ 2. RLS (Row Level Security)

### Onde está Ativo (Blindado)
*   ✅ **Todas as tabelas públicas** têm RLS habilitado (confirmado nas migrations `002` e `029`).
*   ✅ **Políticas de "Select":** Usuários só veem dados da sua própria `empresa_id` ou tarefas atribuídas a eles.
*   ✅ **Políticas de "Insert/Update":** Apenas usuários com `role = 'admin'` ou `role = 'dono'` podem criar/editar dados sensíveis.

### Onde era Frágil (Corrigido Recentemente)
*   **Recursão Infinita:** Havia um bug onde a policy de `profissionais` checava a própria tabela `profissionais` para ver se o usuário era admin, criando um loop.
    *   *Correção:* Implementada na migration `20260105120000` usando `auth.jwt() -> app_metadata` ao invés de query recursiva.

---

## ⚡ 3. Edge Functions (Serverless Deno)

Funções que rodam no servidor para bypassar RLS ou executar lógica complexa.

| Função | O que faz | Quem pode chamar | Risco |
| :--- | :--- | :--- | :--- |
| `create-os-by-function` | Cria tarefa + micro-tarefas em transação. | Authenticated Users | 🔴 **Crítico**. Se falhar, cria tarefa "fantasma" sem itens. |
| `delete-professional` | Remove usuário do Auth e da tabela pública. | Admin Only | 🔴 **Crítico**. Apaga dados irreversivelmente. |
| `send-push-notification` | Dispara WebPush via FCM/Vapid. | Database Trigger (Webhook) | 🟡 Médio. Spam potencial. |
| `create-tenant` | Provisiona nova empresa e admin inicial. | Super Admin | 🔴 Alto. Porta de entrada de novos clientes. |
| `system-check` | Endpoint de healthcheck. | Public (Anon) | 🟢 Baixo. Apenas status. |

---

## 🚨 4. Fluxo Real de Segurança & Alertas

### ⚠️ Alerta 1: Service Role Key
As Edge Functions utilizam a `SUPABASE_SERVICE_ROLE_KEY` para operar com privilégios de "Deus".
*   **Risco:** Se essa chave vazar no frontend (em um `.env` exposto), qualquer um deleta o banco inteiro.
*   **Auditoria:** O arquivo `.env` não está no git, mas verifique se ele não foi commitado no histórico antigo.

### ⚠️ Alerta 2: Triggers em Cascata
O banco possui triggers complexas (`028_notification_triggers.sql`).
*   **Cenário:** Ao atualizar uma tarefa → Trigger dispara → Chama Edge Function → Envia Push.
*   **Problema:** Se a Edge Function demorar (timeout), a transação do banco pode travar ou ficar lenta.
*   **Recomendação:** Migrar chamadas de Edge Function para **pg_net** (assíncrono) ou fila de processamento, para não segurar o UPDATE do usuário.

### ⚠️ Alerta 3: Armazenamento (Storage)
Os buckets de arquivos (anexos das tarefas) devem ter policies de RLS também.
*   **Status:** Tabelas têm RLS, mas *buckets* frequentemente são esquecidos como "Public".
*   **Ação:** Verificar no painel do Supabase se o bucket `task-attachments` está restrito a usuários logados.

---

*Documento gerado para equipe de Infraestrutura e Security Ops.*
