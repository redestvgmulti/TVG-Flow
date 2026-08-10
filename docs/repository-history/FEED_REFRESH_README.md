# Feed Refresh - FlowOS

Sistema de atualização de dados em tempo real para dashboards e listas de tarefas.

---

## 1. Visão Geral

**O que é:** Mecanismo híbrido de refresh de dados que combina pull-to-refresh mobile, botão manual desktop e realtime subscriptions.

**Por que existe:** Garantir que usuários vejam dados atualizados sem necessidade de reload de página.

**Onde é usado:**
- Admin Dashboard (`/admin`)
- Tasks Management (`/admin/tarefas`)
- Staff Dashboard (`/staff`)
- OperationalFeed (sidebar realtime)

---

## 2. Princípios de Design (Contrato)

### Regras Imutáveis

- **Pull-to-refresh:** Mobile only (`@media max-width: 768px`)
- **Botão refresh:** Desktop only (fixed top-right, oculto em mobile)
- **Refresh nunca faz hard reload:** Sempre fetch + update state
- **Contexto preservado:** Scroll, filtros e seleções mantidos
- **Realtime incremental:** Eventos prependados, não substituem tudo
- **Dashboards safe replace:** Setar novo state completo é seguro

---

## 3. Componentes-Chave

### RefreshContext (`src/contexts/RefreshContext.jsx`)

**Responsabilidade:** Orquestrar refresh global com mutex para mutations.

**NÃO alterar:**
- `isMutating` ref (mutex global)
- `triggerRefresh()` guards (isRefreshing, isMutating)
- Minimum delay de 800ms (UX deliberada)

---

### PullToRefresh (`src/lib/pullToRefresh.js`)

**Responsabilidade:** Capturar gesture de pull em mobile e disparar refresh.

**NÃO alterar:**
- Threshold de ativação (80px)
- CSS transforms para feedback visual
- Event listeners de touch

---

### Botão Refresh Desktop (`src/styles/refresh-button.css`)

**Responsabilidade:** UI para refresh manual em desktop.

**NÃO alterar:**
- Fixed positioning (top: 80px, right: 24px)
- Media query de ocultação mobile (<768px)
- Spinning animation

---

### OperationalFeed (`src/components/dashboard/OperationalFeed.jsx`)

**Responsabilidade:** Exibir eventos realtime de micro-tasks.

**NÃO alterar:**
- Deduplicação por ID (linhas ~95-105)
- Limit de 50 eventos (linha ~42)
- Filter de status 'pendente' (linha ~39)

---

### Chart RPC (`supabase/migrations/20260119_chart_aggregation_function.sql`)

**Responsabilidade:** Agregar dados server-side para chart do dashboard.

**NÃO alterar:**
- Lógica de agregação SQL
- SECURITY DEFINER
- Número padrão de dias (30)

---

## 4. Fluxos Importantes

### Refresh Manual (Desktop)

1. Usuário clica botão "Atualizar"
2. `handleManualRefresh()` → `fetchData(true)`
3. `isRefreshing` state = true (UI mostra spinner)
4. Fetch Supabase com reset de paginação
5. State atualizado, `isRefreshing` = false

### Pull-to-Refresh (Mobile)

1. Usuário arrasta para baixo
2. Gesture detectado (threshold 80px)
3. `RefreshContext.triggerRefresh()` chamado
4. Componente executa fetch registrado
5. Visual feedback completado

### Realtime Update (OperationalFeed)

1. Subscription Supabase recebe INSERT/UPDATE
2. `handleNewEvent()` transforma evento
3. Deduplicação verifica se ID já existe
4. Se existe: atualiza; se não: prepend
5. Lista mantida em max 50 itens

### Mutation + Refresh (Mutex)

1. Usuário deleta task
2. `setMutating(true)` antes de mutation
3. DELETE executado
4. Se refresh disparar → bloqueado por mutex
5. `setMutating(false)` em finally
6. Refresh agora permitido

---

## 5. O Que Foi Corrigido (19/01/2026)

**C1: ORDER BY Server-Side**
- Tasks agora ordenadas por deadline no servidor
- Tasks sem deadline aparecem no final (`nullsLast`)
- Garante ordenação consistente entre páginas

**C2: Chart Agregação RPC**
- Dashboard chart usa função SQL `get_dashboard_chart_data(30)`
- Payload reduzido 99% (~100KB → ~1KB)
- Performance 50x melhor (~500ms → ~10ms)

**C3: Botão Refresh Desktop**
- Botão manual adicionado (fixed top-right)
- Melhora UX para usuários desktop

**I1: Deduplicação Realtime**
- OperationalFeed deduplica eventos por ID
- Previne duplicatas quando realtime + refresh ocorrem simultâneos

**I2: Fetch Paralelo Staff**
- Staff Dashboard usa `Promise.all` para micro + macro tasks
- Latência reduzida 50% (~400ms → ~200ms)

**I3: Mutex Mutation/Refresh**
- RefreshContext bloqueia refresh durante mutations ativas
- Previne race conditions e flicker visual

**M2: Skeleton Durante Refresh**
- Skeleton exibido em `loading || isRefreshing`
- UX mais suave sem flash de conteúdo

---

## 6. Onde NÃO Mexer Sem Revisão

### ORDER BY em Tasks (`src/pages/admin/Tasks.jsx`, linha ~257)

```javascript
.order('deadline', { ascending: true, nullsLast: true })
```

**Risco:** Alterar ordenação pode ocultar tasks urgentes.

---

### RPC do Chart (`Dashboard.jsx`, linha ~151)

```javascript
const { data: chartDataRaw } = await supabase.rpc('get_dashboard_chart_data', { days_back: 30 })
```

**Risco:** Remover RPC reverte para fetch de 300+ records (payload 100x maior).

---

### Mutex RefreshContext (`src/contexts/RefreshContext.jsx`, linhas 22-26)

```javascript
if (isMutating.current) {
    console.warn('[RefreshContext] Mutation in progress, skipping refresh')
    return
}
```

**Risco:** Remover mutex causa race conditions visíveis ao usuário.

---

### Deduplicação OperationalFeed (`src/components/dashboard/OperationalFeed.jsx`, linhas ~95-105)

```javascript
const exists = prev.find(e => e.id === eventId)
if (exists) {
    return prev.map(e => e.id === eventId ? newEvent : e)
}
```

**Risco:** Remover deduplicação causa UI com eventos duplicados.

---

## 7. Checklist Rápido para Deploys Futuros

### Pré-Deploy

- [ ] Build local passou sem erros?
- [ ] RPC `get_dashboard_chart_data` existe no Supabase?
- [ ] Nenhuma alteração em ORDER BY de Tasks?
- [ ] Nenhuma alteração em deduplicação OperationalFeed?

### Pós-Deploy

- [ ] Dashboard chart carrega < 500ms?
- [ ] Tasks ordenadas corretamente (urgentes primeiro)?
- [ ] Botão "Atualizar" desktop funciona?
- [ ] Realtime sem eventos duplicados?
- [ ] Console limpo (sem erros críticos)?
- [ ] Refresh manual não quebra filtros?

---

## 8. Estado Atual do Sistema

**Status:** Produção estável  
**Performance:** Chart 50x mais rápido, Staff 2x mais rápido  
**Escala:** Pronto para uso moderado (até 10K tasks)  
**Monitoramento:** Supabase Logs (manual, 7 dias)  

**Ação necessária:** Nenhuma  
**Próxima revisão:** Quando crescimento atingir 10K tasks OU 30 dias

---

**Última atualização:** 19/01/2026  
**Documentação relacionada:** Ver `/brain/13b582a6-*/ANALISE_POS_DEPLOY.md` para detalhes técnicos
