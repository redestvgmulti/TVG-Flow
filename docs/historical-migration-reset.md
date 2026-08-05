# Correção histórica do reset da policy de OS

## Escopo

Esta correção atua somente em
`20260318203441_fix_os_deletion_bug.sql`. Ela não autoriza migration remota,
edição do ledger, deploy, merge ou alteração das fases territoriais.

O objetivo é permitir que bancos novos, resets, CI e homologações
reconstruídas ultrapassem a colisão histórica da policy de `public.tarefas`.
Ambientes que já registraram a migration no ledger normalmente não executam
novamente o arquivo alterado.

## Causa raiz comprovada

Os dois arquivos não são byte-idênticos:

| Migration | SHA-256 original | Efeito relevante |
| --- | --- | --- |
| `20260318171700_fix_os_deletion_bug.sql` | `3A3DDB3DDA7CA50B42B4E3BBF4C336922B6B88860E34B1D0A2151CA306D351FC` | Cria a policy para `authenticated`, incluindo `assigned_to` e consulta direta a `tarefas_micro` |
| `20260318203441_fix_os_deletion_bug.sql` | `13777A9EC8A280A53300EB73F327E0D1E9DD33E864A3B92A830EFA26E548CB95` | Pretende substituir a consulta direta por `is_user_assigned_to_task(id)`, com roles `PUBLIC` |

A migration `20260318192804_fix_rls_infinite_recursion_final.sql`, executada
imediatamente antes da segunda, cria `is_user_assigned_to_task(uuid)` como
`SECURITY DEFINER`. Portanto, a segunda migration contém uma evolução
semântica deliberada e não pode virar no-op.

A falha ocorre porque a segunda migration remove duas policies legadas, mas
não remove nem trata `RLS: admin ou envolvidos podem modificar`, já criada
pela primeira. O `CREATE POLICY` termina com `policy already exists`.

Migrations posteriores (`20260319184400` e `20260319214911`) substituem a
mesma policy novamente. Elas confirmam que o nome estável é intencional e que
a migration intermediária precisa ser registrada, mas não tornam seguro
ignorar sua mudança.

## Estratégia

A migration posterior agora executa uma transição atômica e fail-closed:

1. lê a policy homônima em `pg_policies`;
2. aceita somente a definição exata criada pela primeira migration;
3. aceita replay quando a definição alvo já está presente;
4. cria a definição alvo quando a policy está ausente;
5. aborta com `historical OS policy migration found an unexpected definition`
   diante de qualquer outra definição;
6. somente depois da validação remove as duas policies legadas originais;
7. troca a policy predecessor pela policy alvo dentro do mesmo bloco `DO`.

Não há `USING (true)`, `EXCEPTION WHEN OTHERS`, alteração de RLS ou edição do
ledger. Uma policy divergente não é sobrescrita silenciosamente.

## Contrato da policy após a migration corrigida

| Propriedade | Valor |
| --- | --- |
| Schema/tabela | `public.tarefas` |
| Nome | `RLS: admin ou envolvidos podem modificar` |
| Tipo | `PERMISSIVE` |
| Roles | `PUBLIC`, preservando a segunda migration original |
| Command | `ALL` |
| USING | `is_admin_safe() OR is_super_admin() OR created_by = auth.uid() OR is_user_assigned_to_task(id)` |
| WITH CHECK | igual a `USING` |

`auth.uid()` nulo não satisfaz criador ou participação. As funções de admin e
de participação também dependem do usuário autenticado. A correção não
adiciona grants e não cria acesso anônimo.

## Reprodução e verificação isolada

Com o Supabase local ativo:

```powershell
$env:RUN_LOCAL_HISTORICAL_MIGRATION_SQL='1'
node --test --test-isolation=none tests/migrations/historical-os-policy-reset.test.mjs
Remove-Item Env:RUN_LOCAL_HISTORICAL_MIGRATION_SQL
```

O teste cria e remove um database local exclusivo e cobre:

- predecessor exato seguido da migration corrigida;
- replay da migration corrigida;
- ausência da policy;
- policy divergente `USING (true)`, que deve falhar e permanecer inalterada;
- unicidade, roles, command, `USING` e `WITH CHECK` da policy alvo.

## Reset oficial descartável

Em 2026-08-05, um projeto Supabase vazio recebeu as 65 migrations da base
`d09a9a002e5e9f1594615e9bc78f22c91808be76`, com somente a correção deste
arquivo. O mecanismo oficial `supabase start` inicializou o banco e aplicou as
migrations em ordem, sem seed, SQL preparatório ou edição de ledger.

Resultado:

- migration corrigida: ordinal 39/65, aplicada com sucesso;
- sequência alcançou e aplicou `20260802193321`, ordinal 64/65;
- a última migration, `20260802213527_autopublisher_visual_catalog_operational_tenant.sql`, abortou com
  `AUTOPUBLISHER_OPERATIONAL_TENANT_NOT_FOUND`.

A migration 65 exige o tenant fixo
`cd287e6e-f273-4d0f-a72d-2a8c391e40e9` e um conjunto operacional de masters.
Ela é byte-inalterada na base original. A nova falha é um defeito histórico
independente/dependência de dado operacional em banco vazio e não foi
corrigida nesta branch.

Por essa regra de parada, a integração descartável das fases territoriais e
os contratos pós-reset não foram executados. Isso evita misturar uma segunda
correção histórica ou alterações territoriais neste commit.

## Riscos e rollout

- Novos resets continuam bloqueados na migration 65 até uma tarefa separada
  definir como dados tenant-bound devem ser tratados em bancos vazios.
- A correção desta branch está certificada apenas para a colisão da migration
  39 e seus cenários isolados.
- Não foi consultado o ledger remoto. Nenhum impacto em produção é afirmado.
- Não aplicar remotamente antes de revisão humana e de uma decisão separada
  sobre a migration operacional tenant-bound.
