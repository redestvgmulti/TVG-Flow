# `candidate_news.image_external` provenance

## Conclusion

`ap.candidate_news.image_external` is not part of the versioned database
contract. It was an intermediate boolean written by the March 2026 image
internalization workflow, but no migration ever created the column. The two
writers were later removed while the unused frontend projection remained.

The safe correction is to stop requesting the nonexistent field. No database
column, backfill, default, index, policy, trigger, renderer change, or snapshot
rewrite is required.

## Provenance

- `5b615cd4b73d497bed7ca903a46ce91b5a6000f8` introduced the field in code.
  `ap-employee-generator` and `ap-image-fetcher` calculated it as true when an
  image URL existed but no `imagem_storage` path had been produced. The same
  commit added it to the AutoPublisher list projection.
- `914e65a32d3b0e3c0e3f2dc59b54042cdb0be341` removed the write from
  `ap-image-fetcher` while retaining the canonical `imagem_storage` update.
- `438dbdf6ecafb884082cecf6ba6ea6771e73cceb` removed the remaining write from
  `ap-employee-generator`. Candidate creation continued to persist
  `imagem_url`, and render resolution used the URL/storage fields and frozen
  snapshot.
- The frontend projection survived unchanged, although no UI branch reads
  `item.image_external`.

Repository-wide history searches (`git log -S`, `git log -G`, all local branch
tips, and unreachable commits) found no migration, generated type, seed, dump,
fixture, RPC, or active consumer defining a database contract for the field.

## Canonical image contract

| Field | Meaning | Current consumers |
| --- | --- | --- |
| `imagem_url` | Source/manual image URL and legacy render fallback | ingestion, editor, generator, renderer, cards |
| `imagem_storage` | Optional path in the `ap-images` bucket | image fetcher, renderer, cards |
| `render_url` | Final persisted render URL | renderer, publication, download and cards |
| `studio_media_image_url` | Studio-only source asset | studio workflow and final card fallback |
| `render_snapshot` | Immutable render contract, including source assets for versioned renders | renderer and retry logic |

`image_external` did not replace or preserve information required by those
fields. Its historical value was derivable from the URL/storage state and was
never used to decide rendering, Feed/Reels behavior, publication, or status.

## Environment comparison

Both the schema reconstructed from the official migration chain and the
retained local database omit `image_external`. The retained local database also
contains candidate rows using the canonical image fields, which confirms that
the missing field is not needed to interpret existing records. No remote
environment was queried.

## Verification

Run the focused contract test:

```powershell
node --test tests/master-v1/candidate-news-image-contract.test.mjs
```

Then reconstruct the database from the official migration chain and request the
candidate list through local PostgREST. The request must succeed without a
structural mock and its `select` parameter must not contain `image_external`.

This change affects only the frontend projection. Existing rows, RLS, legacy
snapshots, renderer contracts, Feed, Reels, Stories, and territorial feature
flags remain unchanged.

## Local certification limits

The disposable integrated database applied all 74 migrations and exposed the
canonical candidate projection through local PostgREST with HTTP 200. The same
database correctly rejects an explicit `image_external` projection with HTTP
400, proving that the frontend fix removes the schema mismatch rather than
masking it.

The browser harness used no structural route mock for `candidate_news` and the
retained local database recorded 50 successful candidate requests, zero failed
candidate requests, and zero `image_external` requests. It produced form,
snapshot, render-plan, and provider-mock evidence for all nine format/mode
combinations.

Full visual certification remains blocked by two independent historical local
schema drifts that are outside this correction:

- the clean reconstructed database has `public.get_agencia_cliente_id()`
  querying the absent `public.clientes.tipo` column;
- the retained local database lacks
  `ap.master_render_configs.sponsor_count`, causing its final console-clean
  assertion to fail.

Neither issue was fixed or mocked here. The provider remained mocked and no
Placid request was made.
