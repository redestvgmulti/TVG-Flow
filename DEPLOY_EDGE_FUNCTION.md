# Deploy Edge Function - create-os-by-function

## Problema Corrigido

A Edge Function estava usando `cliente_id` (campo deprecated) ao invés de `empresa_id`, causando falhas ao criar tarefas.

## Mudanças Feitas

**Arquivo**: `supabase/functions/create-os-by-function/index.ts`

- Linha 56: `cliente_id: empresa_id` → `empresa_id: empresa_id`
- Linha 221: `cliente_id: empresa_id` → `empresa_id: empresa_id`

## Como Fazer Deploy

### Opção 1: Via Supabase CLI (Recomendado)

```bash
cd "/Users/geovanepanini/Desktop/PROJETOS/TVG Flow"
npx supabase functions deploy create-os-by-function
```

Se der erro de autenticação, faça login primeiro:

```bash
npx supabase login
```

### Opção 2: Via Supabase Dashboard

1. Acesse: https://supabase.com/dashboard/project/[seu-project-id]/functions
2. Clique em "create-os-by-function"
3. Clique em "Edit function"
4. Cole o conteúdo atualizado de `supabase/functions/create-os-by-function/index.ts`
5. Clique em "Deploy"

### Opção 3: Copiar e Colar Manualmente

1. Abra o arquivo: `supabase/functions/create-os-by-function/index.ts`
2. Copie TODO o conteúdo
3. Vá para Supabase Dashboard → Functions → create-os-by-function
4. Cole o código
5. Deploy

## Verificação

Após o deploy, teste criando uma nova tarefa:

1. Acesse `/admin/tarefas/nova`
2. Preencha o formulário
3. Clique em "Criar OS"
4. **Esperado**: Tarefa criada com sucesso, sem erros no console

## Erros Anteriores (Corrigidos)

- ❌ `FunctionClientError` - Edge Function retornou non-2xx
- ❌ `FunctionHttpError` - Edge Function retornou non-2xx  
- ❌ `Error creating OS` - Edge Function retornou non-2xx

**Causa**: Campo `cliente_id` não existe na tabela `tarefas`, apenas `empresa_id`

**Solução**: Atualizado Edge Function para usar `empresa_id`
