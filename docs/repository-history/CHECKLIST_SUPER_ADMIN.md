# ✅ Checklist Final - Configurar Super Admin

## Status Atual
- ✅ Código frontend atualizado (email correto em 3 arquivos)
- ✅ Rotas do super admin configuradas (`/platform/*`)
- ✅ Migration SQL criada
- ⚠️ **FALTA**: Criar usuário no Supabase Auth

---

## Passos para Completar (Execute NESTA ORDEM)

### 1️⃣ Criar Usuário via Supabase Dashboard
📍 **URL**: https://supabase.com/dashboard/project/gyooxmpyxncrezjiljrj/auth/users

**Ação**:
1. Clique em **"Add user"** → **"Create new user"**
2. Preencha:
   - **Email**: `geovanepanini@icloud.com`
   - **Password**: `G1eovane23*`
   - ✅ **Marcar**: "Auto Confirm User"
3. Clique em **"Create user"**

---

### 2️⃣ Elevar a Super Admin via SQL

Após criar o usuário, **execute** [`elevate_to_super_admin.sql`](file:///Users/geovanepanini/Dev/FlowOS/elevate_to_super_admin.sql) no SQL Editor:

```sql
INSERT INTO public.profissionais (id, email, nome, role, ativo, created_at)
SELECT 
    u.id,
    u.email,
    'Geovane Panini',
    'super_admin',
    true,
    now()
FROM auth.users u
WHERE u.email = 'geovanepanini@icloud.com'
ON CONFLICT (id) DO UPDATE
SET role = 'super_admin', ativo = true;
```

---

### 3️⃣ Fazer Login

**URL da aplicação**: http://localhost:5173/login (ou sua URL de dev)

**Credenciais**:
- Email: `geovanepanini@icloud.com`
- Senha: `G1eovane23*`

**Redirecionamento esperado**: `/platform` (Super Admin Dashboard)

---

## Verificação

Após login, você deve:
- ✅ Ver "Super Admin" no sidebar
- ✅ Ter acesso às rotas:
  - `/platform` - Dashboard
  - `/platform/companies` - Empresas
  - `/platform/reports` - Relatórios
  - `/platform/system` - Status do Sistema

---

## Arquivos Importantes

| Arquivo | Descrição |
|---------|-----------|
| [`elevate_to_super_admin.sql`](file:///Users/geovanepanini/Dev/FlowOS/elevate_to_super_admin.sql) | SQL para criar profissional |
| [`SUPER_ADMIN_FIX_GUIDE.md`](file:///Users/geovanepanini/Dev/FlowOS/SUPER_ADMIN_FIX_GUIDE.md) | Guia detalhado |
| [`AuthContext.jsx`](file:///Users/geovanepanini/Dev/FlowOS/src/contexts/AuthContext.jsx) | Email atualizado (linhas 183, 291) |
| [`Login.jsx`](file:///Users/geovanepanini/Dev/FlowOS/src/pages/Login.jsx) | Roteamento após login (linha 30) |
