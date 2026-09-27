# Historical migration markers

This directory records production-history versions whose original operations are
not safe to replay from the repository. The paired files in
`supabase/migrations/` are comment-only markers so local history can represent
the production ledger without repeating a production-specific action.

## `20260920210432_reenable_ap_render_pipeline_cron_jobs`

- Remote migration name: `reenable_ap_render_pipeline_cron_jobs`.
- Classification: `REMOTE_ONLY_OPERATIONAL_HISTORICAL_MARKER`.
- Known date: 2026-09-20.
- Provenance identifier: production migration version with one recorded
  statement (157 raw characters in the audit snapshot).
- The original action activated production scheduler jobs through nonportable
  numeric identifiers. It is environment-specific and is not safe to replay.

The original SQL must never be executed again. The repository marker is
intentionally comment-only.

## `20260920222508_cleanup_tvgmulti_prontas_publicadas_backlog`

- Remote migration name: `cleanup_tvgmulti_prontas_publicadas_backlog`.
- Classification: `REMOTE_ONLY_ONE_OFF_DATA_HISTORICAL_MARKER`.
- Known date: 2026-09-20.
- Provenance identifier: production migration version with one recorded
  statement (1964 raw characters in the audit snapshot).
- The original action was a destructive, tenant-scoped one-off production
  cleanup. Repeating it could remove business data.

The original SQL must never be executed again. The repository marker is
intentionally comment-only.
