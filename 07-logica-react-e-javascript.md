# Auditoria de Lógica React & JavaScript | TVG Flow
**Data de Geração:** 06/01/2026
**Autor:** Antigravity (React Architect)
**Versão:** 1.0

---

## 🧠 1. Gerenciamento de Estado Global

### 1.1. Context API vs. Redux/Zustand
O projeto utiliza **apenas Context API** nativa.
*   **Veredito:** Adequado para o escopo atual, mas requer cuidado com re-renderizações desnecessárias.
*   **Contextos Ativos:**
    1.  `AuthContext`: Controla Sessão, User e Role. (Crítico)
    2.  `RefreshContext`: Controla o spinner global de "pull-to-refresh". (UX)
    3.  `InAppNotificationContext`: Sistema de toasts global. (UI)

### 1.2. AuthContext (O Coração da App)
Análise do arquivo `src/contexts/AuthContext.jsx`:
*   ✅ **Pontos Fortes:**
    *   Usa `useRef` (`isFetchingRef`) para evitar requests duplicados de perfil.
    *   Gerencia sessão "boot" (bloqueante) vs. "profile hydration" (non-blocking) corretamente.
    *   Tratamento de "Reconexão" (`window.addEventListener('online')`) é um toque excelente de resiliência.
    *   Implementa um "God Mode" hardcoded para o Super Admin (`geovanepanini@agencyflow.com`) como fallback de segurança.
*   ⚠️ **Pontos de Atenção:**
    *   **Side Effects:** A função `signIn` dispara um update de `last_activity_at` no banco sem `await` (fire-and-forget). Se a conexão cair no milissegundo exato, o update falha silenciosamente. (Aceitável, mas notável).
    *   **Acoplamento:** O contexto sabe demais sobre "Roles" e "Status de Empresa". Idealmente, isso seria isolado em um `usePermissions`.

---

## ⚡ 2. Race Conditions & Data Fetching

### 2.1. O Problema do `useEffect` Limpo
Na maioria dos componentes (ex: `Tasks.jsx`), o padrão de data fetching é:
```javascript
useEffect(() => {
    fetchData()
}, [])
```
*   ❌ **O Erro:** Não há `AbortController`.
*   **Cenário de Quebra:**
    1.  Usuário abre "Tarefas" (Request A inicia).
    2.  Usuário clica rápido em "Dashboard".
    3.  Usuário volta para "Tarefas" (Request B inicia).
    4.  Request A completa depois de B. O estado é sobrescrito com dados velhos.
*   **Correção Recomendada:** Usar `React Query` (cache + auto-deduplication) ou implementar cleanup function no `useEffect` com flag `active`.

### 2.2. O "Monstro" `Tasks.jsx`
O componente `Tasks.jsx` (admin) é o maior ofensor de lógica complexa.
*   **Estado Gigante:** Possui ~25 `useState` independentes. Isso torna o fluxo de dados difícil de rastrear.
*   **Mistura de Responsabilidades:** Faz fetch, filtra dados no cliente (`getFilteredTasks`), gerencia modais e lógica de negócio.
*   **Risco:** Qualquer alteração aqui tem 80% de chance de introduzir um bug de regressão.

---

## 🪝 3. Hooks Personalizados

*   `useAppVisibility`: Detecta se o app está em foreground/background. Útil para pausar real-time quando o usuário minimiza a aba.
*   **Falta de Hooks:** O projeto carece de hooks utilitários básicos. Vemos repetição de lógica que poderia ser:
    *   `useForm` (para formulários complexos como NewOS)
    *   `useFetch` (para padronizar requests e loadings)
    *   `useDebounce` (para a busca na tabela de tarefas)

---

## 🧩 4. Acoplamento & Arquitetura

### 4.1. Supabase "Vazado"
A instância `supabase` é importada diretamente em componentes de UI (`import { supabase } from ...`).
*   **Problema:** Se decidirmos trocar o backend (ou mudar a estrutura de uma tabela), teremos que caçar referências em 50 arquivos.
*   **Solução:** Camada de Serviço (`src/services/*`). O projeto JÁ TEM isso (`dashboardService.js`, `professionalsService.js`), mas os componentes novos ignoram e chamam `supabase` direto. **Disciplina necessária.**

### 4.2. Lógica de "Negócio" no Frontend
Calculadoras de preço, regras de status e validações complexas estão espalhadas em `handleSubmit` de formulários.
*   Exemplo: A lógica de "calcular progresso" da tarefa está duplicada no `Tasks.jsx` e `StaffTasks.jsx`. Se a regra mudar, um lado fica desatualizado.

---

## 📝 5. Veredito

O código React é **Funcional e Moderno (Hooks)**, mas sofre de **Crescimento Orgânico Desordenado**.
Não há erros graves de arquitetura (como Prop Drilling excessivo), mas falta padronização no Data Fetching e abstração de lógica de negócio.

**Prioridade de Refatoração:**
1.  **Race Conditions:** Implementar `AbortController` ou React Query.
2.  **Extração de Lógica:** Tirar regras de negócio de dentro dos componentes visuais.
3.  **Hooks:** Criar `useTasks`, `useProfessionals` para centralizar chamadas de API.

---

*Documento gerado para Tech Lead e Dev Team.*
