# AutoPublisher territorial composer v1

This document covers the additive second phase only. It does not authorize a
remote migration, production data change, deploy, merge, or feature enablement.

## Runtime gate

`ap.territorial_composer_features` is independent from the territorial
administration flag. An absent row and `enabled = false` both mean disabled.
The frontend keeps the legacy modal in that state, while
`ap.require_territorial_composer_access` rejects catalog and creation RPCs.

Run the following only against a local or otherwise isolated database, passing
the tenant as a psql variable rather than embedding a production identifier:

```sql
-- inspect
SELECT cliente_id, enabled, updated_at
FROM ap.territorial_composer_features
WHERE cliente_id = :'cliente_id'::uuid;

-- enable locally
INSERT INTO ap.territorial_composer_features (cliente_id, enabled)
VALUES (:'cliente_id'::uuid, true)
ON CONFLICT (cliente_id)
DO UPDATE SET enabled = EXCLUDED.enabled;

-- disable locally / rollback runtime
INSERT INTO ap.territorial_composer_features (cliente_id, enabled)
VALUES (:'cliente_id'::uuid, false)
ON CONFLICT (cliente_id)
DO UPDATE SET enabled = EXCLUDED.enabled;
```

Template rows remain separate and require exactly one active configuration for
each enabled tenant and format. Enabling the flag without complete Feed, Reels,
and Stories mappings fails closed for the missing formats.

## Safe rollback

1. Set `enabled = false` for the affected tenant.
2. Verify the catalog and creation RPCs return
   `TERRITORIAL_COMPOSER_DISABLED`.
3. Revert the phase-two frontend and Edge Function code if necessary. The
   legacy modal and renderer remain version-selected and do not require the new
   tables.
4. Keep candidates already created with `territorial_composer_v1` and keep the
   renderer branch capable of reading them. Do not rewrite their snapshots.
5. Keep reservation, template, and feature tables for audit/history. Do not
   drop them as an operational rollback.
6. If RPC exposure itself must be withdrawn, revoke the new RPC grants from
   `authenticated` and `service_role`, retaining RLS and table data. Never
   replace those policies with permissive fallbacks.

The candidate `story` constraint expansion and optional lifecycle columns are
backward compatible and should not be destructively reverted. Dropping tables,
deleting reservations, or rewriting historical candidates is not an approved
rollback.

## Local visual certification

`tests/master-v1/territorial-composer-visual.mjs` requires:

- a Vite server on `127.0.0.1`;
- Supabase on `127.0.0.1`;
- `LOCAL_TERRITORIAL_EMAIL` and `LOCAL_TERRITORIAL_PASSWORD`;
- an isolated tenant with the feature and three mock template rows enabled.

The script authenticates through the real local login, exercises all nine
format/mode combinations, calls the real local composer RPCs, and mocks only
the generator response/Placid boundary. It persists sanitized payloads, frozen
snapshots, logical render plans, form captures, and explicit mock previews
under `artifacts/territorial-composer/visual-certification`.

The retained local database used on 2026-08-04 predates two unrelated legacy
columns (`candidate_news.image_external` and
`master_render_configs.sponsor_count`). The visual script mocks only those two
legacy read responses instead of changing unrelated schema. This limitation is
recorded in `meta/certification.json`.

## Deno pre-commit review

The final local review used Deno 2.9.4 through `npx`, with its dependency cache
under `C:\tmp`. Deno was not installed globally. `deno check` passed for the
three production entrypoints:

- `ap-employee-generator/index.ts`;
- `ap-render-engine/index.ts`;
- `ap-render-recovery/index.ts`.

The three new phase-two modules also pass the default `deno fmt --check`:
`territorialCandidateWorkflow.ts`, `territorialComposer.ts`, and
`territorialRenderContract.ts`.

A full-format check of the modified entrypoints, shared modules, and direct
imports remains partial because eleven inherited files were already outside
Deno's default formatting in the signed phase-one worktree. The baseline
comparison reproduced that drift before the phase-two changes. The review did
not reformat those large legacy modules because that would create an unrelated
whole-file rewrite. Type checking is certified; repository-wide Deno formatting
is explicitly not certified.

## Clean database pre-commit review

On 2026-08-05 a disposable full Supabase stack was created from the official
local configuration and all 74 migration files. The CLI applied migrations in
timestamp order without a seed or manual SQL. It stopped before any territorial
migration at `20260318203441_fix_os_deletion_bug.sql`: that migration creates
the policy `RLS: admin ou envolvidos podem modificar`, which had already been
created by `20260318171700_fix_os_deletion_bug.sql` and was not dropped.

Both historical migration files are present and byte-unchanged at the original
base `d09a9a002e5e9f1594615e9bc78f22c91808be76`. This is a pre-existing clean
reset defect, not a territorial regression. It was not masked by editing the
migration ledger or executing preparatory SQL. The disposable stack and volume
were removed, and the original `TVG-Flow` local stack was restored from its
preserved volume.

The restored local database demonstrates the reported drift: its ledger ends
before the August migrations, while phase-one and phase-two objects exist. It
also lacks `candidate_news.image_external` and
`master_render_configs.sponsor_count`. The phase-one SQL contract, phase-two
SQL contract, and concurrent reservation test pass on that retained database,
but this is not a clean-sequence proof. A visual run without the two legacy
read mocks remains blocked until the historical reset defect and missing
`image_external` migration provenance are resolved.

## Placid activation blocker

Repository evidence confirms the current physical names
`titulo-materia`, `titulo-png`, `news-image`, `patrocinador-1`, and
`patrocinador-2`. No certified third footer layer was found for every required
Feed, Reels, and Stories template. Local visual certification therefore uses
clearly named mock template tokens and a mock region layer.

Do not enable the composer remotely until a human validates all three template
UUIDs and the complete logical-to-physical layer map, including
`footer_slot_3`. No real Placid request was made during local certification.

| Format | Visual title | Footer slot 1 | Footer slot 2 | Footer slot 3 |
| --- | --- | --- | --- | --- |
| Feed | `titulo-png` is historical evidence only | Pending | Pending for the new contract | Pending |
| Reels | `titulo-png` is historical evidence only | Pending | Pending for the new contract | Pending |
| Stories | Forbidden by contract | Pending | Pending | Pending |

The old renderer proves that `patrocinador-1` and `patrocinador-2` exist in
legacy templates, but it does not prove their position in the new three-footer
layout. No local source proves `patrocinador-2-copy`; it must not be configured
from inference. No authorized Placid sandbox credential was available during
this review, so no provider request was attempted.

### Manual Placid sandbox checklist

1. Confirm in writing that the selected Placid account and templates are
   sandbox-only; do not open or modify production templates.
2. Record the environment, consultation date, and exact template identifier for
   Feed, Reels, and Stories.
3. Export or capture the provider's actual layer list for each template. Record
   exact spelling and case; do not infer copied-layer names.
4. Prepare three visibly distinct local test PNGs labelled REGION, SPONSOR A,
   and SPONSOR B. They must contain no customer or production data.
5. Map `footer_slot_1`, `footer_slot_2`, and `footer_slot_3` to three distinct
   physical layers. Feed and Reels must also map `visual_title`; Stories must
   have no `visual_title` key.
6. Validate the configuration locally before enabling the tenant flag. Missing
   logical keys, duplicate physical names, Story visual-title layers, invalid
   template tokens, and format mismatches must all be rejected.
7. Generate one sandbox image for each format using the three labelled assets.
   Capture the sanitized request, provider request identifier, final image, and
   a screenshot that proves all three footer positions.
8. Confirm that the Stories request contains no seal layer and that optional
   empty slots are omitted rather than sent as empty URLs.
9. Re-run the retry with the frozen snapshot and verify byte-equivalent template
   and layer selection.
10. Only after the evidence is reviewed may a non-production tenant be enabled.
    Staging and production remain NO-GO until then.
