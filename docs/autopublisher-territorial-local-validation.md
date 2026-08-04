# Validação local da administração territorial

Este procedimento é exclusivamente local. Ele não autoriza migration remota,
deploy, push ou alteração de produção.

## Pré-requisitos

- stack local `supabase_db_TVG-Flow`;
- aplicação executada com `VITE_SUPABASE_URL` e
  `VITE_SUPABASE_ANON_KEY` obtidos do `supabase status` local;
- as cinco migrations `2026080411*.sql` aplicadas, em ordem, somente ao banco
  local;
- tenant resolvido por `public.get_agencia_cliente_id()`.

O default da migration permanece `territorial_admin_enabled = false`.

## Preparar o estado desligado

```powershell
Get-Content tests\master-v1\territorial-local-validation-setup.sql -Raw -Encoding UTF8 |
  docker exec -i supabase_db_TVG-Flow psql -U postgres -d postgres
```

Esse fixture não contém UUID de tenant. Ele cria `system_config` com a flag
desligada e adiciona apenas os cards locais ausentes `Estados/Mundo` e
`Eventos`, sem reescrever grupos existentes.

## Consultar

```sql
SELECT cliente_id, territorial_admin_enabled
FROM ap.system_config
WHERE cliente_id = public.get_agencia_cliente_id();
```

## Habilitar somente o tenant local resolvido

```sql
INSERT INTO ap.system_config (cliente_id, territorial_admin_enabled)
VALUES (public.get_agencia_cliente_id(), true)
ON CONFLICT (cliente_id)
DO UPDATE SET territorial_admin_enabled = true;
```

## Desabilitar

```powershell
Get-Content tests\master-v1\territorial-local-validation-disable.sql -Raw -Encoding UTF8 |
  docker exec -i supabase_db_TVG-Flow psql -U postgres -d postgres
```

Com a flag desligada, a aba Regiões desaparece e
`ap.require_territorial_client_access` rejeita todas as RPCs territoriais.
Regiões, cidades, selos vinculados e associações já criados são preservados.

## Conta local de certificação

Use uma conta criada no Auth local, com perfil `admin` ativo e membership ativa
em `public.cliente_profissionais`. Não reutilize credenciais de produção.

Depois da revisão, a conta fixture pode ser removida do Auth local. Desabilitar
a flag é suficiente para retirar a superfície e bloquear mutações sem apagar
os dados de validação.
