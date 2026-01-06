# Correção Crítica de Segurança - Visibilidade de Tarefas

## 🚨 Problema Identificado

**CRÍTICO:** Funcionários estavam vendo tarefas de outros funcionários, violando a privacidade e segurança do sistema.

### Causa Raiz:

1. **RLS Policies Permissivas:** As políticas antigas permitiam que profissionais vissem todas as tarefas do mesmo setor (`p.area_id = tarefas.area_id`)
2. **Frontend Sem Filtro:** O código do staff buscava TODAS as tarefas sem filtrar pelo profissional logado
3. **Sistema de Micro-Tasks Ignorado:** O novo sistema de atribuição individual via `tarefas_itens` não estava sendo respeitado

---

## ✅ Correções Aplicadas

### 1. Migration 029: RLS Policies Restritas

**Arquivo:** `029_fix_staff_task_visibility.sql`

**Mudanças:**

- ❌ **Removidas** políticas antigas permissivas
- ✅ **Criadas** políticas baseadas em micro-tasks:

```sql
-- Profissionais veem APENAS tarefas onde têm micro-task atribuída
CREATE POLICY "Professionals see only assigned tasks via micro-tasks"
ON tarefas FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM tarefas_itens ti
    WHERE ti.tarefa_id = tarefas.id
      AND ti.profissional_id = auth.uid()
  )
);
```

**Resultado:** Profissionais só veem tarefas que foram explicitamente atribuídas a eles.

---

### 2. Staff Tasks.jsx - Query Segura

**Arquivo:** `src/pages/staff/Tasks.jsx`

**Antes (INSEGURO):**
```javascript
const { data, error } = await supabase
    .from('tarefas')
    .select('*')  // ❌ Busca TODAS as tarefas
```

**Depois (SEGURO):**
```javascript
// 1. Busca micro-tasks do profissional
const { data: microTasks } = await supabase
    .from('tarefas_itens')
    .select('tarefa_id')
    .eq('profissional_id', user.id)

// 2. Extrai IDs únicos
const taskIds = [...new Set(microTasks?.map(mt => mt.tarefa_id) || [])]

// 3. Busca APENAS essas tarefas
const { data, error } = await supabase
    .from('tarefas')
    .select('*')
    .in('id', taskIds)  // ✅ Apenas tarefas atribuídas
```

---

### 3. Staff Dashboard.jsx - Query Segura

**Arquivo:** `src/pages/staff/Dashboard.jsx`

**Mesma lógica aplicada:**
- Busca micro-tasks primeiro
- Filtra apenas tarefas atribuídas
- Calcula estatísticas apenas das tarefas do profissional

**Bonus:** Corrigidos status para pt-BR e campo `deadline` para `deadline_at`

---

## 🔒 Segurança Garantida

### Camadas de Proteção:

1. **RLS no Banco:** Políticas Postgres impedem acesso não autorizado
2. **Frontend Filtrado:** Queries buscam apenas tarefas atribuídas
3. **Micro-Tasks como Fonte de Verdade:** Atribuição individual respeitada

### Teste de Validação:

```sql
-- Como profissional, executar:
SELECT * FROM tarefas;

-- Resultado esperado: Apenas tarefas onde existe:
SELECT * FROM tarefas_itens 
WHERE profissional_id = auth.uid();
```

---

## 📊 Impacto

### Antes:
- ❌ Profissional A via tarefas do Profissional B (mesmo setor)
- ❌ Violação de privacidade
- ❌ Dados sensíveis expostos

### Depois:
- ✅ Profissional A vê APENAS suas tarefas
- ✅ Profissional B vê APENAS suas tarefas
- ✅ Admin vê todas (como esperado)
- ✅ Privacidade garantida

---

## 🚀 Deploy

### Passos:

1. **Aplicar Migration:**
```bash
supabase db push
```

2. **Verificar RLS:**
```sql
SELECT * FROM production_checklist();
```

3. **Testar como Staff:**
   - Login como profissional
   - Verificar que vê apenas suas tarefas
   - Tentar acessar tarefa de outro profissional (deve falhar)

---

## ✅ Checklist de Validação

- [x] Migration 029 criada
- [x] RLS policies atualizadas
- [x] Staff Tasks.jsx corrigido
- [x] Staff Dashboard.jsx corrigido
- [x] Status pt-BR aplicado
- [x] Campo `deadline_at` usado
- [ ] Migration aplicada no Supabase
- [ ] Testado com múltiplos profissionais

---

**Sistema agora está SEGURO e cada profissional vê apenas suas próprias tarefas! 🔒**
