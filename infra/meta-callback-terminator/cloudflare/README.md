# Meta OAuth callback terminator: Cloudflare Worker

The production Worker is `meta-oauth-callback` at
`https://meta-oauth-callback.redestvgmulti.workers.dev/meta/oauth/callback`.
It receives Meta's GET callback and forwards only `code` and `state` as a JSON
POST to the fixed Supabase callback URL, with no query string. It has no Meta app
secret, Supabase service-role credential, Vault access, or tenant information.

## Runtime contract

`GET /meta/oauth/callback` accepts exactly one `code` (1..4096 characters) and one
43-character base64url `state`; there are no other query parameters. A bounded
eight-second server-to-server POST uses the runtime-only
`META_CALLBACK_INGRESS_SECRET`. The Worker returns only a Supabase 302 to the
canonical TVG Hub callback path with `meta=connected|select|error`, and optionally
a `META_*` diagnostic code. It rejects tenant IDs, state, OAuth codes, tokens, other
parameters, and arbitrary redirects.

`wrangler.jsonc` is the source of truth. It disables both Workers Logs and Traces
and declares the ingress secret by name only. Do not enable Logs, Traces, Logpush,
Tail Workers, or another query-persisting proxy for this Worker. The source contains
no `console.*` calls. Cloudflare documents that observability must be enabled to
persist Workers Logs and that secrets must not be stored in `vars`:
[configuration](https://developers.cloudflare.com/workers/wrangler/configuration/),
[Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/),
and [secrets](https://developers.cloudflare.com/workers/configuration/secrets/).

## Coordinated release (no real Meta OAuth)

1. Verify the published Worker has both Logs and Traces off and no Logpush/Tail
   binding. Its deployment must be made from this directory so the committed
   `wrangler.jsonc` becomes authoritative. Never place the ingress-secret value in
   a shell history, report, config file, or browser.
2. Confirm the same `META_CALLBACK_INGRESS_SECRET` exists in the production
   Supabase project. Deploy only `ap-meta-oauth-callback` after the Worker source is
   live. Do not yet change Meta's valid redirect URI or `META_OAUTH_REDIRECT_URI`.
3. Send one controlled fake callback to the Worker using a fresh fake code and a
   correctly-shaped nonexistent state. Expected result: safe `META_OAUTH_STATE_INVALID`
   redirect after an internal POST with no query. This is not a Meta OAuth flow.
4. Inspect the exact Cloudflare configuration and Supabase `function_edge_logs` time
   window. Supabase must show `POST` and the bare callback URL, with no code, state,
   body, or ingress secret in URL, metadata, event message, or Function logs. Stop
   if any value appears. Only a later task may register or switch the Meta redirect
   URI to this Worker URL.

The public Supabase gateway cannot prevent an arbitrary direct caller from sending
a query string before Function code runs. This protection covers the configured
Meta callback path, which must remain the Worker after the later cutover.
