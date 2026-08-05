# AutoPublisher operational tenant migration

## Cause

`20260802213527_autopublisher_visual_catalog_operational_tenant.sql` is an
operational rollout for tenant `cd287e6e-f273-4d0f-a72d-2a8c391e40e9`.
It expects four Placid master configurations that are installed separately by
`supabase/seeds/master_render_visual_models.sql`. A database reconstructed
without seeds legitimately has neither that tenant nor those configurations,
so the former unconditional `AUTOPUBLISHER_OPERATIONAL_TENANT_NOT_FOUND`
exception blocked the universal migration chain at version 65.

The preceding migration,
`20260802193321_autopublisher_visual_catalog_expansion.sql`, already owns all
universal schema changes. The tenant-bound migration reads
`public.clientes`, reads and writes `ap.master_render_configs`, and creates no
schema, policy, role, function, trigger, grant or tenant.

## Classification and correction

This file is a tenant-specific operational rollout, not a structural migration
or a generic data migration. Its fixed tenant ID and fixed Placid template UUIDs
must not be generalized to an arbitrary tenant.

The correction changes only the missing-tenant branch:

- tenant absent: emit `AUTOPUBLISHER_OPERATIONAL_TENANT_ABSENT` as a `NOTICE`
  and exit the anonymous block without writes;
- tenant present with the exact four legacy masters: preserve the original
  conversion, catalog inserts and final validation;
- tenant present with an incomplete master set: abort with
  `AUTOPUBLISHER_EXISTING_MASTER_SET_INCOMPLETE`;
- tenant present with mismatched or colliding UUIDs/scopes: preserve the
  original explicit collision errors.

The whole operation remains one PostgreSQL `DO` statement. An error rolls back
all changes from the block, so partial tenant state is never treated as an empty
environment and is not silently repaired.

## Verification

Static and opt-in runtime coverage is in
`tests/migrations/autopublisher-operational-tenant-reset.test.mjs`.

With a local Supabase PostgreSQL instance running:

```powershell
$env:RUN_LOCAL_OPERATIONAL_TENANT_MIGRATION_SQL='1'
node --test tests/migrations/autopublisher-operational-tenant-reset.test.mjs
Remove-Item Env:RUN_LOCAL_OPERATIONAL_TENANT_MIGRATION_SQL
```

The runtime test creates and removes its own uniquely named database. It proves
empty-database behavior, another-tenant isolation, exact rollout and replay,
partial-state rollback, and divergent-state rejection.

## Local reset evidence (2026-08-05)

A disposable Supabase project, with seeds disabled and no preparatory SQL,
applied all 65 base migrations. Its ledger ended at
`20260802213527`; `public.clientes` and `ap.master_render_configs` both
contained zero rows. The corrected migration emitted its absence `NOTICE`.

A second disposable project applied the same base plus the unchanged signed
territorial commits:

- `b851045d8d22f34909ab1839b89fc1028c69e3f6`;
- `f913eb90006966ddf9652f0da0a044cef0e067d2`.

That ledger reached all 74 migrations at `20260804203000`. The territorial
administration contract, composer contract, concurrency test, historical policy
contract, Node suite, ESLint and Vite build passed locally. Both territorial
feature defaults remained `false`, and no operational tenant or master row was
created.

The integration reset also confirmed an independent, already documented schema
gap: `ap.candidate_news.image_external` is absent from the official migration
chain. `ap.master_render_configs.sponsor_count` is present. This correction
does not manufacture provenance for the missing historical column; staging
remains blocked until that separate issue is authorized and resolved.

## Impact and rollback

This historical-file correction affects new databases, local resets, CI,
staging reconstruction, and any environment where migration 65 has not yet
been recorded. Environments that already have version 65 in their migration
ledger do not automatically re-execute the edited file.

No remote ledger or production state was inspected in this work. The safe code
rollback is to revert this commit; no data rollback is needed for an absent
tenant because the corrected path performs no writes. Existing operational
catalog data must not be deleted as a rollback mechanism.
