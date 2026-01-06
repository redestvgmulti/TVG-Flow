# Pontos Frágeis & Bugs Conhecidos | TVG Flow
**Data de Geração:** 06/01/2026
**Autor:** Antigravity (QA Auditor)
**Contexto:** Pós-Auditoria Geral
**Versão:** 1.0

---

## 🛑 1. Riscos Críticos (Fator "Vai Quebrar")

### 1.1. Monólito de Tarefas (Performance)
*   **Local:** `src/pages/admin/Tasks.jsx` (L. 64KB)
*   **Tipo:** ⚠️ Fragilidade Arquitetural
*   **Impacto:** **Funcional**. O navegador trava ao carregar muitas tarefas.
*   **Probabilidade:** Alta (cresce com o uso).
*   **Análise:** O componente carrega *todas* as tarefas do banco para filtrar no client-side. Em conexões 3G ou com >1000 registros, a tela ficará branca.
*   **Mitigação:** Implementar **Server-Side Pagination** e **Virtualização** da lista (ex: `react-window`).

### 1.2. Upload de Arquivos "Cego"
*   **Local:** `TaskForm.jsx` / Supabase Storage
*   **Tipo:** 🕷️ Risco Oculto
*   **Impacto:** **Funcional/Custo**.
*   **Probabilidade:** Média.
*   **Análise:** Não há validação rígida de tipos de arquivo (EXE, ZIPs gigantes) ou compressão no frontend. Um usuário pode subir um vídeo de 500MB e estourar a cota do Supabase.
*   **Mitigação:** Restringir MIME-types no `<input>` e nas Policies do Storage. Redimensionar imagens no client antes do upload.

---

## ⚠️ 2. Fragilidades Funcionais (Depende de Sorte)

### 2.1. Push Notifications (Web PWA)
*   **Local:** `sw.js` / `Login.jsx`
*   **Tipo:** ⚠️ Fragilidade
*   **Impacto:** **Funcional**. Usuário não recebe alertas.
*   **Probabilidade:** Alta (iOS e usuários que negam permissão).
*   **Análise:** WebPush depende 100% da permissão do Browser e do SO. No iOS, só funciona se o app estiver instalado na Home Screen (PWA).
*   **Mitigação:** Criar fallback: sempre enviar **Email** ou **In-App** (Sininho) junto com o Push. Nunca confiar só no Push.

### 2.2. Feed Operacional (Realtime)
*   **Local:** `Dashboard.jsx` (Hooks de `realtime`)
*   **Tipo:** ⚠️ Fragilidade de Rede
*   **Impacto:** **Visual**. Feed vazio ou desatualizado.
*   **Probabilidade:** Média (oscilações de internet).
*   **Análise:** Se o WebSocket cair, o feed para de atualizar. Não há mecanismo robusto de "reconexão com backoff" ou polling de segurança.
*   **Mitigação:** Adicionar um `SWR` ou `React Query` para fazer polling a cada 30s e garantir a verdade, mesmo sem WebSocket.

### 2.3. Deep Linking Sem Validação
*   **Local:** Rotas com `:id` (ex: `/admin/companies/:id`)
*   **Tipo:** 🐛 Bug Potencial
*   **Impacto:** **Visual/Crash**.
*   **Probabilidade:** Baixa (só se usuário manipular URL).
*   **Análise:** Se eu digitar um ID inválido (ex: `/admin/companies/batata`), o componente tenta fazer fetch, o Supabase retorna erro 400/22P02, e a aplicação pode explodir (Tela Branca) se não houver `try/catch` tratando UUID inválido.
*   **Mitigação:** Validar se `id` é UUID v4 antes de chamar o banco. Usar `ErrorBoundary` para capturar a quebra.

---

## 🎨 3. UI/UX & Mobile (Onde o Usuário Sofre)

### 3.1. Performance do Glassmorphism (Blur)
*   **Local:** CSS Global (`tokens.css`, `base.css`)
*   **Tipo:** ⚠️ Fragilidade Visual
*   **Impacto:** **Visual/Bateria**.
*   **Probabilidade:** Alta em Androids de entrada.
*   **Análise:** O uso excessivo de `backdrop-filter: blur(20px)` é pesado para a GPU. Causa "scroll lag" em dispositivos fracos.
*   **Mitigação:** Media query para desativar blur em low-power mode ou telas pequenas:
    ```css
    @media (prefers-reduced-motion) { .glass { backdrop-filter: none; background: rgba(255,255,255,0.95); } }
    ```

### 3.2. Modais em Mobile
*   **Local:** `Professionals.jsx` (Modal de Edição)
*   **Tipo:** 🐛 Bug UX
*   **Impacto:** **Visual**. Teclado cobre o botão "Salvar".
*   **Probabilidade:** Alta.
*   **Análise:** Modais centralizados vertically costumam ser cobertos pelo teclado virtual no celular, impedindo a ação de submit.
*   **Mitigação:** Transformar Modais em **Drawers** (Gavetas que sobem do fundo) quando estiver em mobile.

---

## 🔒 4. Segurança (Riscos Ocultos)

### 4.1. Dados Sensíveis no LocalStorage
*   **Local:** `AuthContext.jsx`
*   **Tipo:** ⚠️ Prática Comum (Risco Baixo/Médio)
*   **Análise:** O Supabase persiste o JWT no LocalStorage por padrão. Se houver um ataque XSS (script malicioso injetado), o token pode ser roubado.
*   **Mitigação:** Configurar políticas de segurança de conteúdo (CSP) rígidas no Vercel Header.

---

*Relatório gerado para priorização de refatoração.*
