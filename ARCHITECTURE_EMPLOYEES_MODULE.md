# Arquitetura do Módulo de Funcionários - TVG Flow

**Autor:** Arquiteto de Sistemas (Agentic AI)
**Data:** 18/12/2025
**Contexto:** Módulo de Gestão de Pessoas (Admin Level)

---

## 1. Estrutura de Pastas Recomendada

Para manter a organização e escalabilidade, recomendo refatorar a estrutura plana atual (`src/pages/admin/Professionals.jsx`) para uma estrutura baseada em funcionalidades.

```text
src/
├── pages/
│   └── admin/
│       └── professionals/           # Módulo isolado
│           ├── index.jsx            # Lista (Data Grid)
│           ├── ProfessionalForm.jsx # Componente reutilizável (Create/Edit)
│           ├── Create.jsx           # Página Container (Wrapper do Form)
│           ├── Edit.jsx             # Página Container (Fetch Data + Form)
│           └── Details.jsx          # View Only (se necessário)
├── components/
│   └── professionals/               # Componentes específicos menores
│       ├── ProfessionalCard.jsx
│       └── StatusBadge.jsx
├── key_functions/                   # Hooks/Logic
│   └── useProfessionals.js          # Encapsula chamadas ao Supabase/Edge Functions
└── services/
    └── api/
        └── professionals.js         # Interface direta com Edge Functions
```

---

## 2. Fluxo Lógico Detalhado

### 2.1. Criação de Profissional (Fluxo com Convite)

1.  **Admin** acessa rota `/admin/professionals/new`.
2.  Preenche formulário (Nome, E-mail, Área, Perfil) - **SEM SENHA**.
3.  **Frontend** chama `supabase.functions.invoke('create-professional', payload)`.
4.  **Edge Function**:
    *   Valida Admin.
    *   Cria usuário em `auth.users` SEM senha e com `email_confirm: false`.
    *   Insere registro em `public.profissionais`.
    *   **Envio de Email:** Dispara `resetPasswordForEmail` (template padrão 'Reset Password' do Supabase).
    *   **Rollback:** Em caso de falha no DB ou Email, remove o usuário criado para garantir consistência.
5.  **Funcionário** recebe email com link.
6.  **Funcionário** clica no link e é direcionado para `/reset-password`.
7.  **Funcionário** define sua senha.
8.  **Sistema** realiza logout e redireciona para `/login`.

### 2.2. Edição de Profissional

1.  **Admin** clica em "Editar" na lista.
2.  **Frontend** busca dados via `useProfessionals (getById)`.
    *   *Nota: Senha nunca é retornada.*
3.  **Admin** altera dados (ex: mudar de área).
4.  **Frontend** chama `supabase.from('profissionais').update()`.
    *   *Nota: Atualização de dados cadastrais simples não requer Edge Function, desde que o RLS permita que Admin edite.*
    *   *Exceção: Para resetar senha ou mudar e-mail (auth), deve-se usar outra Edge Function ou API de Admin.*

---

## 3. Especificação da Edge Function

**Nome:** `create-professional`
**Path:** `supabase/functions/create-professional/index.ts`

### Pseudocódigo

```typescript
import { serve } from "std/server"
import { createClient } from "supabase-js"

serve(async (req) => {
  // 1. Setup do Cliente Supabase (Service Role para poder criar user)
  const supabaseAdmin = createClient(URL, SERVICE_ROLE_KEY)
  
  // cliente para verificar quem chamou (usando token do header)
  const supabaseClient = createClient(URL, ANON_KEY, { global: { headers: req.headers } })

  try {
    // 2. Security Check: Quem está chamando é Admin?
    const { data: { user } } = await supabaseClient.auth.getUser()
    const { data: requesterProfile } = await supabaseAdmin
      .from('profissionais')
      .select('role')
      .eq('id', user.id)
      .single()

    if (!requesterProfile || requesterProfile.role !== 'admin') {
      throw new Error("Unauthorized: Only admins can create professionals")
    }

    // 3. Parse Body
    const { email, password, name, area_id, role } = await req.json()

    // 4. Create Auth User
    const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // Auto-confirmar para evitar fluxo de e-mail complexo inicial
      user_metadata: { name } // Opcional, bom para redundancy
    })

    if (authError) throw authError

    // 5. Insert into Public Table
    // Se falhar aqui, idealmente deveríamos deletar o authUser criado (compensating transaction)
    const { error: dbError } = await supabaseAdmin
      .from('profissionais')
      .insert({
        id: authUser.user.id, // VITAL: Mesmo ID
        nome: name,
        email: email,
        area_id: area_id,
        role: role || 'profissional',
        ativo: true
      })

    if (dbError) {
      // Rollback manual (deletar usuário criado se falhar no banco)
      await supabaseAdmin.auth.admin.deleteUser(authUser.user.id)
      throw dbError
    }

    return new Response(JSON.stringify({ success: true, id: authUser.user.id }), { status: 200 })

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 400 })
  }
})
```

---

## 4. Estrutura de Rotas (React Router)

Utilizando a estrutura existente no `App.jsx`, adicionaremos as sub-rotas.

### Pseudocódigo (`src/App.jsx` ou `src/routes.jsx`)

```jsx
<Route path="/admin" element={<ProtectedRoute><AdminLayout /></ProtectedRoute>}>
  
  {/* ... outras rotas ... */}

  {/* Módulo Funcionários - Agrupado */}
  <Route path="professionals">
      {/* Lista Principal */}
      <Route index element={<ProfessionalsList />} />
      
      {/* Criação - Renderizado em Drawer/Modal ou Página Dedicada */}
      <Route path="new" element={<ProfessionalCreate />} />
      
      {/* Detalhe/Edição - :id captura o UUID */}
      <Route path=":id" element={<ProfessionalDetails />} />
      <Route path=":id/edit" element={<ProfessionalEdit />} />
  </Route>

</Route>
```

**Nota UX:** Recomendo o uso de *Intercepting Routes* ou Modais controlados por *State* para a criação/edição (`/admin/professionals/new` abrindo um Modal sobre a lista) para manter a fluidez do "CityOS", ao invés de navegar para uma página em branco.

---

## 5. Pontos Críticos de Segurança (RLS)

A tabela `public.profissionais` é o coração da segurança da aplicação.

### Políticas RLS (Row Level Security)

1.  **Quem pode ver? (SELECT)**
    *   **Admin:** Vê TUDO. `(auth.uid() IN (SELECT id FROM profissionais WHERE role = 'admin'))`
    *   **Profissional:** Vê APENAS a si mesmo. `(auth.uid() = id)`
    *   *Impacto:* Se um profissional tentar listar `/admin/professionals`, a query retornará vazio ou erro. O Frontend deve tratar isso e nem mostrar o link no menu.

2.  **Quem pode criar? (INSERT)**
    *   **Ninguém via API direta.** A política deve ser `FALSE` (ou apenas `service_role`).
    *   **Motivo:** A criação deve passar estritamente pela Edge Function para garantir a sincronia com `auth.users`.

3.  **Quem pode editar? (UPDATE)**
    *   **Admin:** Pode editar dados de qualquer um (exceto campos sensíveis de sistema se houver).
    *   **Profissional:** Pode editar campos limitados (ex: foto, telefone) do PRÓPRIO perfil? Definir regra de negócio. Inicialmente, recomendo `FALSE` ou restrito a colunas específicas.

4.  **Quem pode deletar? (DELETE)**
    *   **Ninguém via API direta.**
    *   **Motivo:** Deletar um profissional envolve remover do Auth também. Deve ser feito via Edge Function `delete-professional` (que você já implementou ou está no roadmap).

### Resumo das Policies SQL Recomendadas

```sql
-- Habilitar RLS
ALTER TABLE public.profissionais ENABLE ROW LEVEL SECURITY;

-- 1. Leitura: Admin vê geral, User vê só ele
CREATE POLICY "Profissionais: View Policy" ON public.profissionais
FOR SELECT
USING (
  (auth.uid() = id) OR 
  (EXISTS (SELECT 1 FROM public.profissionais WHERE id = auth.uid() AND role = 'admin'))
);

-- 2. Update: Apenas Admin (Simplificado para V1)
CREATE POLICY "Profissionais: Admin Update" ON public.profissionais
FOR UPDATE
USING (
  EXISTS (SELECT 1 FROM public.profissionais WHERE id = auth.uid() AND role = 'admin')
);

-- 3. Insert/Delete: Bloqueado (Apenas via Edge Function/Service Role)
-- Nenhuma política criada = Negado por padrão (Deny All)
```
