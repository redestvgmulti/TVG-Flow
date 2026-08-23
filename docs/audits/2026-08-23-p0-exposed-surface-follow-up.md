# P0 exposed-surface follow-up — 2026-08-23

The post-deploy schema-only dump found historical anonymous ACLs that were not
visible in the initial seven-table probe:

- 60 exposed relations had an explicit `anon` grant in `public`/`ap`;
- 29 non-extension functions had an explicit/effective anonymous execution
  path before the follow-up;
- nine operational views responded to anonymous PostgREST requests, and six
  returned a non-empty payload at probe time;
- PostgreSQL default privileges for the `postgres` owner granted all new
  tables, functions, and sequences in `public` to both API roles.

The affected diagnostic views included active/blocked query and lock views,
table sizes, tenant compliance, notification queue health/alerts, SLA, and
workflow-order diagnostics. Payload values are intentionally not recorded.

The follow-up migration:

1. revokes all current relation, sequence, and application-function privileges
   from `anon` in the exposed schemas;
2. makes every ordinary exposed view `security_invoker=true`;
3. makes operational/debug/legacy diagnostic views service-role-only;
4. removes permissive `anon` and `authenticated` defaults for future objects;
5. fails the transaction if any anonymous relation/application-function grant,
   owner-executed ordinary view, or permissive API default ACL remains.

Pure functions owned by PostgreSQL extensions are excluded from the
application-function postcondition; they do not access application data and
their ACL is extension-managed. Existing authenticated grants and all table
rows remain unchanged.
