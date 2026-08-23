# P0 Edge Function containment matrix — 2026-08-23

Baseline: Supabase project `gyooxmpyxncrezjiljrj`, 45 active functions, 21 with
`verify_jwt=false`. Caller classification combines the canonical `main` source,
active `cron.job` targets, database trigger definitions, and deployed metadata.
No secret value is recorded here.

| Function | Baseline | Use | Caller | Internal secret | Expected exposure | Decision |
| --- | --- | --- | --- | --- | --- | --- |
| `alterar-prazo-os` | no JWT, v11 | Human deadline operation | authenticated client contract | no | authenticated human | JWT required; retain server-side permission check |
| `ap-feed-composer` | no JWT, v10 | obsolete composer worker | no active cron or repository caller | no | none | LEGACY — DEACTIVATE |
| `ap-instagram-publisher` | no JWT, v11 | internal publisher worker | internal worker chain | yes, fail-closed | internal only | INTERNAL AUTHENTICATED BY SECRET |
| `ap-learning-engine` | no JWT, v10 | obsolete learning worker | no active cron or repository caller | no | none | LEGACY — DEACTIVATE |
| `ap-scheduler` | no JWT, v10 | obsolete scheduling endpoint | no repository caller | no | none | LEGACY — DEACTIVATE |
| `ap-send-to-studio` | no JWT, v8 | simulated studio transfer | no repository caller | no | none | LEGACY — DEACTIVATE |
| `complete-micro-task` | no JWT, v13 | Human task completion | staff UI | no | authenticated human | JWT required plus tenant membership |
| `converter-os-para-complexa` | no JWT, v11 | Human OS conversion | admin UI | no | authenticated admin | JWT required plus tenant membership |
| `create-microtasks` | no JWT, v8 | superseded task helper | no current repository caller | no | none | LEGACY — DEACTIVATE |
| `delete-task-attachment` | no JWT, v11 | Human attachment deletion | file service | no | authenticated human | JWT required; retain owner/admin authorization |
| `diagnostic-tool` | no JWT, v8 | arbitrary SQL diagnostic | no legitimate caller | no | none | LEGACY — DEACTIVATE (P0 quarantine) |
| `excluir-os` | no JWT, v11 | Human soft-delete operation | authenticated client contract | no | authenticated human | JWT required plus tenant-safe permission helper |
| `get_super_admin_dashboard_stats` | no JWT, v8 | duplicate Edge dashboard | frontend uses protected RPC, not Edge | no | none | LEGACY — DEACTIVATE |
| `meeting-reminders` | no JWT, v11 | meeting reminder worker | active `meeting-reminders-cron` | target state: yes | internal only | INTERNAL AUTHENTICATED BY SECRET |
| `notify-overdue-tasks` | no JWT, v11 | overdue notification worker | active `notify-overdue-tasks-hourly` | target state: yes | internal only | INTERNAL AUTHENTICATED BY SECRET |
| `process-notifications` | no JWT, v12 | duplicate queue fallback | active processing is database cron, no Edge caller | no | none | LEGACY — DEACTIVATE |
| `return-micro-tasks` | no JWT, v8 | obsolete plural endpoint | frontend calls singular protected endpoint | no | none | LEGACY — DEACTIVATE |
| `scheduler-deadline-notifications` | no JWT, v8 | obsolete external scheduler | no active cron or repository caller | no | none | LEGACY — DEACTIVATE |
| `send-push-notification` | no JWT, v13 | push delivery worker | database notification trigger | target state: yes | internal only | INTERNAL AUTHENTICATED BY SECRET |
| `system-check` | no JWT, v11 | Legacy system integrity view | no mounted runtime caller found | no | active super-admin only | JWT required plus active super-admin role |
| `test-db` | no JWT, v10 | production DDL diagnostic | no legitimate caller | no | none | LEGACY — DEACTIVATE (P0 quarantine) |

Additional deployed drift: `return-micro-task` (singular, JWT enabled, v11) was
not present on canonical `main`. Its deployed source was downloaded read-only,
added to version control, and hardened with caller/target tenant checks.

Rollback is version-specific: redeploy the prior retained source/version for a
human/internal function, or redeploy the baseline source at the version shown
above for a quarantined function. Database rollback is a separate reviewed
migration; no domain data restore is required.
