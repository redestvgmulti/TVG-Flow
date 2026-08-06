# Client classification and retained sponsor-count drift

## Conclusions

The two local failures have independent causes.

1. `public.clientes.tipo` is an unversioned compatibility field. The historical
   `get_agencia_cliente_id()` function was created in March 2026 against that
   field even though no repository migration, including the pre-rebaseline
   history, ever added it to `public.clientes`.
2. `ap.master_render_configs.sponsor_count` is present in the canonical
   migration chain. Its absence from the retained database is local drift: that
   database's ledger ends before the migration that adds the column, while
   later territorial objects were applied outside the ledger.

The canonical certification environment is therefore a newly reconstructed
database, not the retained local database.

## Provenance of client classification

`public.clientes` was captured in
`20260223031956_remote_schema.sql` with seven columns: `id`, `nome`,
`created_at`, `cnpj`, `ativo`, `drive_link`, and `empresa_id`.
No later migration adds, renames, or removes a client classification field.

The versioned business classification is
`public.empresas.tipo_negocio`, constrained to `agency`, `studio`,
`producer`, or `other`. Historical setup scripts classified TVG Multi as
`tipo_negocio = 'agency'` before the broken resolver was introduced.

Commit `cd5c1cddd33964e41cc116e0ac26d76329a38a16` added
`get_agencia_cliente_id()`. It selected the first active row from
`public.clientes` where the unversioned `tipo` value was `agencia`. The
query had no `auth.uid()` predicate, no membership check, no deterministic
tie handling, and could return a client from another tenant.

The retained local database contains one manually classified
`clientes.tipo = 'agencia'` row. That row links through `empresa_id` to the
same company's canonical `empresas.tipo_negocio = 'agency'` row. This is
evidence of local compatibility drift, not evidence of a missing universal
column contract.

## Active consumers

| Consumer | Purpose | Expected behavior |
| --- | --- | --- |
| `EmployeeMode.jsx` | Resolve a client when no explicit client was provided | One authorized agency client or a visible error |
| `visualTitleGroups.js` | Scope badge administration | One authorized agency client |
| `tenantAuthorization.ts` | Preference when the caller has multiple authorized clients | Never an authorization source; result must remain in the JWT allowlist |
| Contract tests | Preserve the resolver call and tenant authorization behavior | Fail closed on absent or ambiguous context |

The function remains necessary for compatibility, but its global
`clientes.tipo` implementation is not.

## Correction

Migration `20260805193000_fix_get_agencia_cliente_id_tenant_resolution.sql`
keeps the function signature and consumers intact while replacing its lookup.

The resolver now:

- requires `auth.uid()`;
- starts from `ap.get_user_cliente_ids()`, the existing active membership
  allowlist;
- joins `public.clientes.empresa_id` to `public.empresas.id`;
- uses the versioned `empresas.tipo_negocio = 'agency'` classification;
- requires both the client and company to be active;
- returns the only matching client;
- fails closed when none or more than one match;
- revokes execution from `PUBLIC` and `anon`;
- preserves execution for authenticated callers and service-role compatibility,
  while a service-role call without a user subject still fails `AUTH_REQUIRED`.

No `clientes.tipo` column, backfill, default, or operational tenant row is
created.

## Retained database drift

The retained database reports only 36 ledger entries, ending at
`20260724201000_partial_unique_candidate_url`. It records
`20260722234139_autopublisher_master_v1_contract`, whose
`CREATE TABLE IF NOT EXISTS` could not repair a pre-existing partial table,
but it does not record `20260802193321_autopublisher_visual_catalog_expansion`.

Migration `20260802193321` explicitly executes:

```sql
ALTER TABLE ap.master_render_configs
    ADD COLUMN IF NOT EXISTS sponsor_count smallint;
```

The retained schema nevertheless contains all phase-1 territorial tables and
all phase-2 territorial tables, including rotation reservations, without their
migration versions in the ledger. It is therefore a derived test database that
received later SQL outside the official sequence.

It must not be repaired by manually adding `sponsor_count` or editing the
ledger. It remains useful only as historical diagnostic evidence.

## Canonical environment

Final certification must use a disposable database reconstructed from the
official migration sequence, with:

- both historical reset fixes;
- the signed `image_external` correction;
- this resolver migration;
- territorial phases 1 and 2;
- no structural seed or preparatory SQL;
- fixtures inserted only after migrations;
- local feature flags only;
- provider mocking allowed, but no schema or RPC mocking.

A post-migration CLI health timeout is reported separately from migration
success. The ledger and the health of DB, REST, Auth, Storage, and Studio are
the structural gate.
