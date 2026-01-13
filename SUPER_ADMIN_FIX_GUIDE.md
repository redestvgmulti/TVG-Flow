## Passos para Corrigir o Login do Super Admin

### Problema Identificado
✅ Profissional existe na tabela `public.profissionais`  
❌ Usuário NÃO existe ou está incorreto em `auth.users`

### Solução Rápida (Via Supabase Dashboard)

1. **Acesse o Supabase Dashboard**:
   - URL: https://supabase.com/dashboard/project/gyooxmpyxncrezjiljrj/auth/users

2. **Procure o usuário existente**:
   - Busque por `geovanepanini@icloud.com`
   - Se não existir, vá para o passo 3
   - Se existir mas não consegue logar, delete e recrie

3. **Criar novo usuário**:
   - Clique em **"Add user"** → **"Create new user"**
   - **Email**: `geovanepanini@icloud.com`
   - **Password**: `G1eovane23*`
   - ✅ **Marque**: "Auto Confirm User" 
   - Clique em **"Create user"**

4. **Copiar o User ID gerado**

5. **Executar SQL para vincular ao profissional**:
   ```sql
   -- Substitua USER_ID_AQUI pelo ID que você copiou
   UPDATE public.profissionais
   SET id = 'USER_ID_AQUI'
   WHERE email = 'geovanepanini@icloud.com';
   ```

6. **Testar login** com:
   - Email: `geovanepanini@icloud.com`
   - Senha: `G1eovane23*`

---

### Alternativa: Usar o Script SQL Simplificado

Se preferir fazer tudo via SQL, execute este comando no SQL Editor:

```sql
-- Deletar registros antigos
DELETE FROM auth.users WHERE email = 'geovanepanini@icloud.com';
DELETE FROM auth.identities WHERE email = 'geovanepanini@icloud.com';

-- IMPORTANTE: Depois disso, CRIE O USUÁRIO MANUALMENTE via Dashboard
-- (SQL direto em auth.users não funciona bem para password hashing)
```

Depois crie via dashboard seguindo os passos acima.
