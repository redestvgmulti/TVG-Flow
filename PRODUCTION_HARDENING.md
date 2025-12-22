# Production Hardening - TVG Flow CityOS

## Visão Geral

Este documento descreve todas as medidas de hardening aplicadas para deixar o sistema 100% pronto para produção.

---

## ✅ 1. CONTROLE DE MIGRATIONS

### Tabela: `schema_migrations`

**Criada em:** `028_production_hardening.sql`

```sql
CREATE TABLE schema_migrations (
    id SERIAL PRIMARY KEY,
    migration_name TEXT UNIQUE NOT NULL,
    applied_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);
```

**Migrations Registradas:**
- `021_create_empresas`
- `022_create_empresa_profissionais`
- `023_create_tarefas_itens`
- `024_create_tarefas_itens_historico`
- `025_add_empresa_to_tarefas`
- `026_migrate_deadline_datetime`
- `027_fix_microtasks_profissionais_status`
- `028_production_hardening`

**Uso:**
```sql
SELECT * FROM schema_migrations ORDER BY applied_at DESC;
```

---

## ✅ 2. VERIFICAÇÃO DE INTEGRIDADE DO SISTEMA

### Função: `check_system_integrity()`

**Valida:**
- ✅ Todas migrations críticas aplicadas
- ✅ Todas tabelas existem
- ✅ Todos triggers ativos
- ✅ Constraints críticas presentes
- ✅ RLS ativa em tabelas sensíveis

**Uso:**
```sql
SELECT * FROM check_system_integrity();
```

**Retorno:**
```sql
{
    status: 'OK' | 'ERROR',
    missing_migrations: [],
    missing_tables: [],
    missing_triggers: [],
    missing_constraints: [],
    rls_issues: [],
    message: 'Sistema íntegro e pronto para produção'
}
```

---

## ✅ 3. VERIFICAÇÃO DE INTEGRIDADE DE DADOS

### Função: `check_data_integrity()`

**Valida:**
- ✅ Micro-tarefas órfãs (sem tarefa macro)
- ✅ Atribuições inválidas (profissional fora da empresa)
- ✅ Tarefas concluídas com micro-tarefas pendentes
- ✅ Status inválidos
- ✅ Deadlines faltando

**Uso:**
```sql
SELECT * FROM check_data_integrity();
```

**Retorno:**
```sql
[
    {
        check_name: 'orphaned_microtasks',
        status: 'OK' | 'WARNING' | 'ERROR',
        issue_count: 0,
        details: 'Micro-tarefas sem tarefa macro'
    },
    ...
]
```

---

## ✅ 4. CHECKLIST DE PRODUÇÃO

### Função: `production_checklist()`

**Verifica:**
- ✅ Migrations aplicadas
- ✅ Triggers ativos
- ✅ RLS ativa
- ✅ Constraints corretas
- ✅ Foreign keys válidas

**Uso:**
```sql
SELECT * FROM production_checklist();
```

**Retorno:**
```sql
[
    { category: 'Migrations', item: 'Critical migrations applied', status: '✅', details: '7 of 7 applied' },
    { category: 'Triggers', item: 'Auto-status update trigger', status: '✅', details: '' },
    { category: 'RLS', item: 'tarefas_itens RLS enabled', status: '✅', details: '' },
    ...
]
```

---

## ✅ 5. HARDENING DE TRIGGERS

### Trigger: `update_tarefa_status_from_itens()`

**Melhorias Aplicadas:**

1. **Evita Updates Desnecessários:**
```sql
-- ANTES: sempre atualiza
UPDATE tarefas SET status = new_status ...

-- DEPOIS: só atualiza se status mudou
IF current_status IS DISTINCT FROM new_status THEN
    UPDATE tarefas SET status = new_status ...
END IF;
```

2. **Proteção contra Race Condition:**
- Usa `COALESCE(NEW, OLD)` para garantir valor
- Verifica status atual antes de atualizar

3. **Não Depende de Frontend:**
- Lógica 100% no banco
- Funciona mesmo sem chamadas da aplicação

---

## ✅ 6. HARDENING DE EDGE FUNCTIONS

### Edge Function: `create-microtasks`

**Validações:**
- ✅ `tarefa_id` obrigatório
- ✅ `profissional_ids` array obrigatório
- ✅ Valida empresa-profissional se `empresa_id` fornecido
- ✅ Usa `service_role` para bypass seguro de RLS
- ✅ Previne duplicações (unique constraint)
- ✅ Retorna erros controlados
- ✅ **NUNCA** retorna stacktrace

**Exemplo de Erro Controlado:**
```json
{
    "error": "Some professionals are not associated with this company",
    "invalid_professionals": ["uuid1", "uuid2"]
}
```

### Edge Function: `system-check`

**Validações:**
- ✅ Chama `check_system_integrity()`
- ✅ Chama `check_data_integrity()`
- ✅ Chama `production_checklist()`
- ✅ Retorna status consolidado
- ✅ **NUNCA** expõe erros internos

**Resposta:**
```json
{
    "system_integrity": {
        "status": "OK",
        "message": "Sistema íntegro e pronto para produção",
        "issues": { ... }
    },
    "data_integrity": [...],
    "production_checklist": [...],
    "timestamp": "2025-12-22T15:41:46Z"
}
```

---

## ✅ 7. HARDENING DE RLS

### Auditoria Completa:

**Tabela: `tarefas_itens`**
- ✅ RLS ativa
- ✅ Profissional: vê apenas suas micro-tarefas
- ✅ Profissional: atualiza apenas suas micro-tarefas
- ✅ Admin: vê todas
- ✅ Admin: pode reabrir (não concluir)
- ✅ Nenhuma policy consulta a própria tabela (evita 42P17)

**Tabela: `empresas`**
- ✅ RLS ativa
- ✅ Admin: full access
- ✅ Profissional: vê apenas empresas vinculadas

**Tabela: `empresa_profissionais`**
- ✅ RLS ativa
- ✅ Admin: full access
- ✅ Profissional: vê apenas suas associações

**Tabela: `tarefas_itens_historico`**
- ✅ RLS ativa
- ✅ Read-only (exceto via trigger)
- ✅ Admin: vê tudo
- ✅ Profissional: vê seus logs

---

## ✅ 8. VERIFICAÇÃO NO FRONTEND (ADMIN)

### Componente: `SystemIntegrityCheck.jsx`

**Comportamento:**

1. **Carregamento Automático:**
   - Executa ao carregar painel admin
   - Chama Edge Function `system-check`

2. **Se Status = OK:**
   - Nenhuma UI exibida
   - Sistema funciona normalmente

3. **Se Status = ERROR:**
   - Banner vermelho no topo (CityOS style)
   - Mensagem: "⚠️ Sistema Inconsistente"
   - Botão "Ver Detalhes" para admin técnico
   - **Bloqueia operações críticas** (via callback)

4. **Detalhes Exibidos:**
   - Migrations faltando
   - Tabelas faltando
   - Triggers faltando
   - Problemas de RLS

**Integração:**
```jsx
import SystemIntegrityCheck from './components/SystemIntegrityCheck'

function AdminLayout() {
    const [systemOk, setSystemOk] = useState(true)

    return (
        <>
            <SystemIntegrityCheck onIntegrityStatus={(status) => {
                setSystemOk(status === 'OK')
            }} />
            
            {/* Bloquear ações críticas se sistema não OK */}
            <button 
                disabled={!systemOk}
                onClick={createTask}
            >
                Criar Tarefa
            </button>
        </>
    )
}
```

---

## ✅ 9. CHECKLIST DE PRODUÇÃO FINAL

### Migrations
- [x] `021_create_empresas`
- [x] `022_create_empresa_profissionais`
- [x] `023_create_tarefas_itens`
- [x] `024_create_tarefas_itens_historico`
- [x] `025_add_empresa_to_tarefas`
- [x] `026_migrate_deadline_datetime`
- [x] `027_fix_microtasks_profissionais_status`
- [x] `028_production_hardening`

### Triggers
- [x] `trigger_update_tarefa_status_after_item_change` (hardened)
- [x] `trigger_log_tarefas_itens_changes`
- [x] `trigger_set_tarefas_itens_concluida_at`

### RLS
- [x] `tarefas_itens` RLS enabled
- [x] `empresas` RLS enabled
- [x] `empresa_profissionais` RLS enabled
- [x] `tarefas_itens_historico` RLS enabled

### Edge Functions
- [x] `create-microtasks` (com validação empresa-profissional)
- [x] `system-check` (validação de integridade)

### Constraints
- [x] Status constraint pt-BR (`pendente`, `concluida`)
- [x] FK to `profissionais` (não `usuarios`)
- [x] Unique constraints (empresa-profissional, tarefa-profissional)

### Frontend
- [x] Nenhum acesso a `auth.users`
- [x] Usa `profissionais` table
- [x] Nenhum `.single()` em tabelas operacionais
- [x] Status pt-BR em toda UI
- [x] `SystemIntegrityCheck` no admin panel

---

## 🚀 DEPLOYMENT GUIDE

### 1. Aplicar Migrations

```bash
# Via Supabase CLI
supabase db push

# Ou via Dashboard
# Upload dos arquivos 021-028 em ordem
```

### 2. Deploy Edge Functions

```bash
# Deploy create-microtasks
supabase functions deploy create-microtasks

# Deploy system-check
supabase functions deploy system-check
```

### 3. Verificar Integridade

```sql
-- No Supabase SQL Editor
SELECT * FROM check_system_integrity();
SELECT * FROM check_data_integrity();
SELECT * FROM production_checklist();
```

**Resultado Esperado:**
```
status: 'OK'
message: 'Sistema íntegro e pronto para produção'
```

### 4. Integrar SystemIntegrityCheck

```jsx
// Em AdminLayout.jsx
import SystemIntegrityCheck from '../components/SystemIntegrityCheck'

<SystemIntegrityCheck onIntegrityStatus={(status) => {
    // Bloquear ações se status !== 'OK'
}} />
```

### 5. Testar Fluxo Completo

1. ✅ Criar empresa
2. ✅ Vincular profissional
3. ✅ Criar tarefa com empresa
4. ✅ Atribuir múltiplos profissionais (via Edge Function)
5. ✅ Profissional conclui sua micro-tarefa
6. ✅ Verificar auto-update da tarefa macro
7. ✅ Admin reabre micro-tarefa
8. ✅ Verificar auditoria em `tarefas_itens_historico`

---

## 🔒 SEGURANÇA GARANTIDA

✅ **Auto-Validação:** Sistema detecta inconsistências automaticamente
✅ **Erros Controlados:** Nunca expõe stacktrace ou dados internos
✅ **RLS Completo:** Todas tabelas sensíveis protegidas
✅ **Auditoria:** Todas mudanças rastreadas
✅ **Validação de Relacionamentos:** Empresa-profissional validada
✅ **Triggers Hardened:** Evita updates desnecessários
✅ **Edge Functions Seguras:** Service role usado corretamente
✅ **Frontend Blindado:** Nenhum acesso direto a auth.users

---

## 📊 MONITORAMENTO

### Verificação Periódica

```sql
-- Executar semanalmente
SELECT * FROM check_data_integrity();
```

**Se encontrar issues:**
1. Revisar logs de auditoria
2. Identificar causa raiz
3. Corrigir dados se necessário
4. Ajustar validações se padrão recorrente

### Alertas Recomendados

- Email se `check_system_integrity()` retornar ERROR
- Log se `check_data_integrity()` encontrar > 10 issues
- Dashboard com `production_checklist()` status

---

**Sistema 100% pronto para produção e escala! 🚀**
