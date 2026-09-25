# Meta OAuth callback terminator

This is a dedicated AWS API Gateway **HTTP API** and Node.js Lambda, with no
CloudFront or Vercel in front. Meta's GET arrives at
`https://<callback-domain>/meta/oauth/callback`; Lambda sends a JSON POST to the
fixed Supabase `ap-meta-oauth-callback` URL **without a query string**. It forwards
only an allowlisted TVG Hub redirect. It has neither Meta app credentials nor
Supabase service-role/Vault/tenant access. The redirect contains only a safe result;
the browser keeps the previously selected tenant in per-tab session storage and
the Supabase status endpoint revalidates that requested tenant. The dedicated ingress secret is shared
only with the Supabase Function.

## Logging boundary

AWS HTTP API access logging is **opt-in**. This template omits
`AccessLogSettings`; the default execute-api endpoint is disabled. Lambda writes
only the fixed event `META_CALLBACK_FORWARDED` on success and does not print the
request, query, body, token, secret, or caught exceptions. Do not enable API Gateway
access logs, request/response data logging, Lambda event logging, CloudFront logs,
or a query-logging WAF/CDN for this hostname. CloudWatch Lambda runtime metadata
may remain, but it must not include request parameters. Confirm the effective AWS
stage and surrounding account-level logging configuration before registering the
Meta URI. Infrastructure source alone is **not** production log certification.

Official basis: [AWS HTTP API access logging](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-logging.html),
[SAM HTTP API properties](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/sam-resource-httpapi.html),
[Supabase log fields](https://supabase.com/docs/guides/observability/log-field-reference).

## Coordinated cutover

1. Choose a dedicated callback FQDN and ACM certificate in one AWS account/Region.
   Review DNS/CDN/WAF hops to ensure none persists query strings. Supply the exact
   Supabase Function URL and TVG Hub HTTPS origin to the SAM stack. Provide a new
   random 32+ character `MetaCallbackIngressSecret` via an approved secret channel;
   do not put it in command history, logs, a committed parameter file, or a browser.
2. Deploy `template.yaml` from this directory with AWS SAM. Point the custom-domain
   DNS target to the API Gateway domain mapping. Verify the effective stage has no
   `AccessLogSettings`, no request data logging, and throttling of 5/s, burst 10.
   Inspect any account-level or perimeter logging before sending a fixture.
3. Set the same ingress secret in the Supabase Edge Function environment. Deploy
   **only** `ap-meta-oauth-callback` after the terminator is reachable, and verify
   direct GET is rejected. Keep Meta's previous URI unchanged until step 5.
4. With a controlled fake code and a fresh 43-character fixture state, send **one**
   GET to the terminator. The internal POST should reach the Supabase callback and
   return a safe state-invalid redirect; no real Meta token exchange occurs because
   the state is absent. Use an approved audit method to inspect the AWS API Gateway
   stage, Lambda log stream, and Supabase `function_edge_logs` for this time window.
   Assert the Supabase callback request URL is the bare pathname, has method POST,
   and neither provider has persisted the fixture code/state. Check AWS logging
   configuration as well as absence of data; no access log by design is a stronger
   signal than searching an empty log group alone. Do not print the fixture values
   while collecting evidence.
5. Only after step 4 passes, register `https://<callback-domain>/meta/oauth/callback`
   as Meta Valid OAuth Redirect URI and set the identical
   `META_OAUTH_REDIRECT_URI` in Supabase. The authorization request and token exchange
   both read this value. Make no real Meta OAuth attempt as part of this task.

If any stage fails, do not switch the redirect URI. If the POST-only callback has
already been deployed, the old direct GET route is intentionally closed; restore
availability through the reviewed coordinated cutover, not by re-accepting secrets
in a Supabase query string.

There is no technical way for the Function to prevent an arbitrary external caller
from sending `?code=...` directly to the Supabase gateway, where URL capture happens
before Function code. The guarantee applies to the configured Meta-to-terminator
production flow, not to malicious direct requests to the public Supabase URL.
