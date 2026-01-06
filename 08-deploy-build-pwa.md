# Deploy, Build & PWA Audit | TVG Flow
**Data de Geração:** 06/01/2026
**Autor:** Antigravity (Platform Engineer)
**Versão:** 1.0

---

## 🏗️ 1. Build Process

### Stack de Build
*   **Pipeline:** Vite 5.x
*   **Comando:** `npm run build` -> `vite build`
*   **Engine:** ESBuild (para minificação e transpilação).

### Otimizações Ativas (`vite.config.js`)
1.  **Console Stripping:** `build.esbuild.drop: ['console', 'debugger']`.
    *   *Efeito:* Em produção, todos os `console.log` somem. Isso é excelente para performance e "limpeza" do console do usuário, mas **impede debugging em prod** sem ferramentas como Sentry.
2.  **Manifest Inject:** O Vite gera dinamicamente a lista de assets para o Service Worker cachear.

---

## 🚀 2. Deploy (Vercel)

### Configuração
*   **Hospedagem:** Vercel (Detectado `vercel.json`).
*   **Framework Preset:** Vite (Single Page App).
*   **Rotas:** O Vercel lida com o *rewriting* para `index.html` automaticamente para rotas client-side.

### Variáveis de Ambiente Críticas
O sistema depende das seguintes chaves (supostamente configuradas no Dashboard da Vercel):
*   `VITE_SUPABASE_URL`: Endpoint da API.
*   `VITE_SUPABASE_ANON_KEY`: Chave pública para o cliente.

⚠️ **Risco:** Se `SUPABASE_SERVICE_ROLE_KEY` (chave mestra) for sem querer adicionada ao ambiente de **Preview** ou **Production** do Frontend, ela vazará no bundle JS?
*   *Análise:* O Vite só expõe variáveis começando com `VITE_` para o cliente. Se a chave não tiver esse prefixo, está segura *mesmo se estiver no .env do servidor*.

---

## 📱 3. PWA (Progressive Web App)

### Estratégia de Update (`UpdateBanner.jsx`)
*   **Tipo:** `registerType: 'prompt'`.
    *   *Comportamento:* O App **não atualiza sozinho**. Ele baixa a nova versão em background e avisa o usuário: "Nova atualização disponível".
    *   *UX:* Componente `UpdateBanner` aparece com animação suave. Ao clicar, recarrega a página (`updateServiceWorker(true)`).
    *   *Veredito:* Excelente escolha para evitar que o app reinicie na cara do usuário enquanto ele preenche um formulário longo.

### Caching (Service Worker / Workbox)
*   **Cache First:** Google Fonts (1 ano de validade).
*   **Network First:** API do Supabase (`*.supabase.co`).
    *   *Resiliência:* Se o usuário ficar offline, ele ainda vê dados cacheados das últimas 50 requisições (`maxEntries: 50`).
    *   *Risco:* Se a API mudar o schema, o cache antigo pode quebrar o app até ser invalidado (24h).

### Manifest (`manifest.json`)
*   **Instalação:** Configuradíssima (`standalone`, cores da marca).
*   **Shortcuts:** Atalhos de "Long Press" no ícone do app para `Hoje` e `Nova Tarefa`. (Toque premium!).

---

## 💣 4. O Que Pode Quebrar (Failure Analysis)

### Cenário A: Deploy Quebrado (Rota 404)
*   Se o `build` falhar, a Vercel segura o deploy anterior. Seguro.
*   Se o deploy subir, mas o usuário tiver um **index.html antigo em cache** tentando buscar um **JS novo que não existe mais** (hash mudou):
    *   *Resultado:* White Screen of Death (ChunkLoadError).
    *   *Mitigação:* Vite costuma lidar bem, mas um `ErrorBoundary` global capturando "ChunkLoadError" e forçando reload é recomendado.

### Cenário B: Service Worker "Zumbi"
*   Se enviarmos um SW bugado que cacheia `index.html` errado:
    *   *Resultado:* O usuário fica preso numa versão eterna do site, mesmo que a gente faça 10 deploys novos.
    *   *Saída de Emergência:* O `vite.config.js` tem `cleanupOutdatedCaches: true`, o que ajuda, mas a rota de fuga manual é instruir o usuário a "Limpar Dados do Site".

---

*Documento gerado para DevOps e Release Managers.*
