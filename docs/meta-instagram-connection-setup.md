# Meta / Instagram connection setup

This release uses Instagram API with Facebook Login with read-only scopes:

- pages_show_list
- pages_read_engagement
- instagram_basic

The application builds the authorization request server-side using the configured
Graph version and the Facebook OAuth dialog endpoint. It sends client_id,
redirect_uri, state, response_type=code and the scopes above. Meta redirects to a
dedicated external callback terminator. The terminator forwards code/state as a
server-side JSON POST to the Supabase callback, without query parameters. The callback
exchanges code, extends the short-lived user token, reads me permissions and reads
me/accounts with id, name, access_token and instagram_business_account id/username.

Page and user tokens are saved only through Supabase Vault. The database stores Vault
UUID references only. The user token is retained as a server-side connection secret;
the normal tenant-local disconnect never performs a remote Meta revocation.

Provision these server-side Edge Function secrets before the first real connection:

| Secret | Required | Notes |
| --- | --- | --- |
| META_APP_ID | Yes | Meta app ID. |
| META_APP_SECRET | Yes | Meta app secret. Never expose or log it. |
| META_OAUTH_REDIRECT_URI | Yes | Exact external HTTPS terminator URI registered in Meta, ending in /meta/oauth/callback. The token exchange uses the identical URI. |
| META_CALLBACK_INGRESS_SECRET | Yes | Dedicated 32+ character secret shared only with the terminator; never expose to Meta or a browser. |
| META_GRAPH_API_VERSION | Yes | Current supported Graph version, written vN.0. |
| FRONTEND_URL | Yes in production | Trusted TVG Hub origin for post-callback redirect. |
| META_ALLOWED_ORIGINS | Yes in production | Comma-separated, exact HTTPS browser-origin allowlist for authenticated Meta Functions. No wildcard is accepted. |

Do not provision Page ID, Instagram user ID, Page access token, user access token or
pilot profile as permanent environment configuration. OAuth discovers those values and
stores them tenant-scoped.

The terminator deployment and coordinated cutover are described in
`infra/meta-callback-terminator/README.md`. Do not change the Meta redirect URI or
deploy the POST-only Supabase callback until the terminator and ingress secret are
ready. The callback URL must exactly match the Meta app setting. Configure Facebook Login
redirect allow-list, app domains and the deauthorization callback at
/functions/v1/ap-meta-deauthorize in the Meta dashboard. This endpoint verifies the
signed request, first marks every matching connection revoked, then performs
recoverable Vault cleanup. A cleanup failure never restores a connection to connected.
This release requests read capabilities only. Publishing, comments and
messages remain unavailable until separately requested and granted.

The long-lived exchange supplies expires_in and the connection stores expires_at. This
release creates no refresh worker or cron. Disconnect is tenant-local: it removes only
the selected connection's local Vault secrets and marks that row disconnected. It does
not call Meta permission revocation because that would revoke the app for every tenant
that shares the same Meta user. Global Meta authorization revocation is a distinct,
future operation.

Primary references:

- https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/
- https://developers.facebook.com/docs/facebook-login/guides/advanced/manual-flow/
- https://developers.facebook.com/docs/facebook-login/guides/access-tokens/get-long-lived/
- https://developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback

Meta changes versions and permission rules. Before provisioning production secrets,
confirm the selected Graph version and requested permissions in the approved Meta app.
