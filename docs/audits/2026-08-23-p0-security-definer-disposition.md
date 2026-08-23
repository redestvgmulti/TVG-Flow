# P0 SECURITY DEFINER disposition — 2026-08-23

Live inventory source: `pg_proc` and `pg_namespace` from production before the
containment migration. The inventory covered every `SECURITY DEFINER` routine
in the exposed `public` and `ap` schemas. Function bodies were inspected only
for authorization, tenant, role, mutation, `auth.users`, and `search_path`
signals; no secret value is recorded here.

## Complete classification

| Classification | Count | P0 disposition |
| --- | ---: | --- |
| Authenticated | 71 | Keep only the existing authenticated contract; remove `PUBLIC`/`anon`; add or retain session, tenant, and role checks. |
| Internal | 63 | Remove browser execution; trigger routines have no API grants; worker/editorial helpers are service-role-only. |
| Administrative | 13 | Remove `PUBLIC`/`anon`; service-only for secret/email primitives; explicit active super-admin wrappers for tenant/company detail APIs. |
| Legacy | 4 | No canonical runtime caller; remove `PUBLIC`/`anon` and do not add a new exposure. |
| Public intentional | 0 | No production TVG Hub caller justified anonymous `SECURITY DEFINER` execution. |
| Unknown | 0 | Every one of the 151 routines received a disposition. |
| **Total** | **151** | Default deny for anonymous execution. |

The four legacy public surfaces are `current_cidade_id`,
`get_institutional_feed`, `get_public_metrics`, and
`resolve_current_city_id`. They belong to inherited municipal/public-feed
schema, have no caller in the canonical TVG Hub runtime, and are not being
reintroduced as public APIs in this P0 phase.

## Critical findings from the live inventory

- 96/151 were executable by `anon` before containment.
- 126/151 were executable by `authenticated` before containment.
- 42/151 lacked an explicit function `search_path`.
- `create_tenant_db`, `get_user_emails_for_ap`, and
  `provision_professional_identity` read `auth.users`.
- `get_user_emails_for_ap`, `get_tenant_details`, the OS permission helpers,
  meeting notification routines, dashboard metrics, template rotation,
  editorial token routines, and Vault helpers were among the anonymous
  surfaces requiring containment.

## Grant rules applied

- All 151: revoke `PUBLIC` and `anon`, then replace the function `search_path`
  with a schema-specific, `pg_catalog`-first allowlist.
- Trigger-returning routines: revoke direct execution from API roles.
- Service-only set: Vault, email export, template/editorial token primitives,
  internal queues/maintenance, and legacy generic mutation helpers.
- Authenticated wrappers: tenant/company details require active super-admin;
  meeting actions derive identity from `auth.uid()` and validate meeting/tenant
  scope; dashboard metrics derive tenant membership from `auth.uid()`.
- Permission helpers called by service-backed Edge Functions validate the
  supplied authenticated user against an active membership in the resource
  tenant and are executable only by `service_role`.

The versioned migration is the source of truth for exact signatures and grant
statements. Post-deploy certification must confirm zero anonymous
`SECURITY DEFINER` grants and zero missing `search_path` entries.
