# AUDITORIA TÉCNICA - FlowOS (v1.0)

**Data:** 18/01/2026
**Responsável:** Antigravity Agent
**Escopo:** Database, Backend (Supabase), Frontend (React), Migrations

---

## 1. 📌 INVENTÁRIO TOTAL DO SISTEMA

### 🗄️ Banco de Dados (Supabase/Postgres)
| Item | Status | Detalhes |
| :--- | :--- | :--- |
| **Tabelas Core** | ✅ Ativo | `tarefas`, `empresas`, `profissionais`, `departamentos`, `reunioes` |
| **Tabelas Auxiliares** | 🟡 Legado | `clientes` (Deprecated - Código aponta `empresas` como verdade) |
| **Tabelas Sistema** | ✅ Ativo | `push_subscriptions`, `notifications` (provável), `reunioes_participantes` |
| **RLS Policies** | ⚠️ Frágil | Existentes, mas constantemente corrigidas ("fix_rls...") e complexas |
| **Functions/RPC** | ⚠️ Misto | Muitos RPCs manuais (`cancel_os`, `update_os`) convivendo com CRUD direto |

### 🛠️ Backend (Edge Functions & Triggers)
| Item | Status | Detalhes |
| :--- | :--- | :--- |
| **Edge Functions** | ⚠️ Inchado | ~20 funcoes ativas. Ex: `create-professional` (CRUD via func), `send-push-notification` |
| **Triggers** | ⚠️ Perigoso | Trigger com **CHAVE DE API HARDCODED** (`020_nuclear_cleanup.sql`) |
| **Auth** | 🟡 Custom | Lógica de `super_admin` hardcoded no frontend e policies complexas |

### 💻 Frontend (React/Vite)
| Item | Status | Detalhes |
| :--- | :--- | :--- |
| **Rotas** | ✅ Ativo | Mapeadas em `App.jsx`. Admin, Staff, Super Admin bem segmentados |
| **Services** | ✅ Central | `src/services` é a camada vital. Abstração razoável do Supabase |
| **Business Logic** | ⚠️ Duplicada | `dashboardMetrics.js` replica regras de negócio do banco no JS (cálculos de status) |
| **Auth Context** | ⚠️ Frágil | `AuthContext.jsx` tem lógica de recuperação de sessão complexa e email hardcoded |

---

## 2. 🧨 LISTA DE CÓDIGOS, TABELAS E FUNÇÕES NÃO UTILIZADAS

### 🗄️ DB Camada
- **🔴 Tabela `clientes`**: O código do `clientService.js` afirma explicitamente que está depreciada e usa `empresas`. Dados nesta tabela são lixo.
- **🟡 Migrations Antigas**: Mais de 130 arquivos de migration. Muitos são correções de correções (`fix_rls`, `fix_rls_v2`, `fix_rls_final`).
- **❓ `020_nuclear_cleanup.sql`**: Migration manual que limpa triggers. Sinal de intervenção manual agressiva.

### ⚙️ Backend Logic
- **🟡 CRUD via Edge Functions**: Funções como `create-professional` poderiam ser substituidas por `insert` direto com RLS bem configurado, reduzindo latência e custo.
- **🟡 `converter-os-para-complexa`**: Função específica que parece não ter uso claro no fluxo principal auditado (dashboard/tarefas).

### 🖥️ Frontend
- **🔴 Referências a `clientes`**: Ainda existem resquícios, mas o service bloqueia uso.
- **🟡 Lógica de "Inglês Legado"**: `dashboardMetrics.js` mantém compatibilidade com status em inglês que não deveriam mais existir.

---

## 3. ⚠️ RISCOS SILENCIOSOS EM PRODUÇÃO

### 🚨 1. Segurança Crítica (P1)
**Arquivo:** `020_nuclear_cleanup.sql`
**Risco:** Existe uma **API KEY (SERVICE_ROLE ou ANON) HARDCODED** dentro da definição da função PL/PGSQL `trigger_send_push_notification`.
**Impacto:** Se este código vazar ou for injetado, um atacante tem acesso total ao banco/funções.

### 🚨 2. Identidade Hardcoded (P2)
**Arquivo:** `AuthContext.jsx` ~ linha 299
**Risco:** Email `geovanepanini@icloud.com` hardcoded como super admin imutável.
**Impacto:** Dificulta a transferência do sistema e cria um backdoor implícito se a lógica de validação do Supabase falhar.

### 🚨 3. Fragilidade de FKs (P2)
**Arquivo:** `taskService.js` (e outros)
**Risco:** Uso sintático de PostgREST explícito: `empresas!tarefas_empresa_id_fkey`.
**Impacto:** Se alguém recriar a FK no banco com nome gerado automaticamente diferente, **todo o frontend quebra** imediatamente.

### 🚨 4. Duplicidade de Regras (P3)
**Arquivo:** `dashboardMetrics.js` vs Banco
**Risco:** O frontend calcula o que é "Atrasado". Se o backend (ex: trigger de notificação) usar outra regra (fuso horário diferente, conta sábado/domingo), o usuário verá um número e receberá notificação de outro.

---

## 4. 🧠 DÍVIDA TÉCNICA REAL

### Classificação: 🟠 ALTA
O sistema cresceu organicamente com muitas correções rápidas ("hotfixes").

- **Dívida de Banco:** Migrations sujas e redundantes. Tabela morta (`clientes`).
- **Dívida de Arquitetura:** Mistura de CRUD direto com RPCs e Edge Functions sem padrão claro.
- **Dívida de Código:** AuthContext tentando gerenciar estados de rede/sessão que o SDK do Supabase já deveria fazer, gerando complexidade (race conditions mencionadas nos comentários do código).

---

## 5. 🧭 VEREDITO FINAL

### O sistema está FINALIZADO? -> **NÃO.**
Ele está **FUNCIONAL**, mas opera com "arames" visíveis.

### Está PRONTO PARA EVOLUIR? -> **NÃO.**
Crescer agora (adicionar funcionalidades) vai aumentar exponencialmente a fragilidade. Cada nova tabela exigirá "fixes" de RLS e triggers manuais, como visto no histórico.

### O sistema precisa de: **CONSOLIDAÇÃO E LIMPEZA**
Antes de qualquer nova feature, é mandatório remover o peso morto e fechar as brechas de segurança.

---

## 6. 🛣️ PRÓXIMOS CAMINHOS POSSÍVEIS

### CAMINHO 1: Limpeza Cirúrgica (RECOMENDADO)
1.  **Segurança Imediata:** Remover API Key do SQL e Email Hardcoded do JS.
2.  **Schema Cleanup:** Dropar tabela `clientes`. Consolidar migrations em um `schema.sql` limpo (dump atual).
3.  **Padronização:** Definir se usamos RPC ou CRUD direto. Eliminar Edge Functions redundantes.

*Riscos:* Parar o desenvolvimento de novas features por 1-2 semanas.

### CAMINHO 2: "Deixar como está" e seguir
Continuar criando features em cima da base atual.

*Riscos:* Altíssima chance de quebra crítica em produção (FKs mudando, bugs de RLS vazando dados). O custo de manutenção vai superar o de desenvolvimento em breve.

### CAMINHO 3: Rewrite Parcial
Reescrever o AuthContext e a camada de Services para usar Padrões Sólidos (TanStack Query, Zod validation).

*Riscos:* Demorado e caro. Talvez desnecessário se o Caminho 1 for bem feito.

---

### 🏁 RECOMENDAÇÃO IMEDIATA
Solicite a execução do **CAMINHO 1** com prioridade máxima na correção da API KEY hardcoded.
