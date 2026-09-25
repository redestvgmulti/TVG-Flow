const CALLBACK_PATH = '/meta/oauth/callback';
const STATE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const DIAGNOSTIC_CODE_PATTERN = /^META_[A-Z_]+$/;
const MAX_QUERY_BYTES = 8_192;
const RESPONSE_HEADERS = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'none'",
  'X-Content-Type-Options': 'nosniff',
};

function reply(status, { location, diagnosticCode, upstreamStatus } = {}) {
  const headers = { ...RESPONSE_HEADERS };
  if (location) headers.Location = location;
  if (diagnosticCode) headers['X-TVG-Terminator-Code'] = diagnosticCode;
  if (upstreamStatus !== undefined) headers['X-TVG-Upstream-Status'] = String(upstreamStatus);
  return new Response(null, {
    status,
    headers,
  });
}

function readConfiguration(env) {
  const callbackUrl = new URL(env.SUPABASE_META_CALLBACK_URL);
  const hubOrigin = new URL(env.TVG_HUB_ORIGIN);
  const secret = env.META_CALLBACK_INGRESS_SECRET;
  if (
    callbackUrl.protocol !== 'https:' || callbackUrl.search || callbackUrl.hash ||
    callbackUrl.username || callbackUrl.password ||
    callbackUrl.href !== 'https://gyooxmpyxncrezjiljrj.supabase.co/functions/v1/ap-meta-oauth-callback' ||
    hubOrigin.href !== 'https://tvgflow.vercel.app/' ||
    !secret || secret.length < 32
  ) throw new Error('TERMINATOR_CONFIGURATION_INVALID');
  return { callbackUrl, hubOrigin, secret };
}

function isSafeRedirect(location, hubOrigin) {
  let redirect;
  try {
    redirect = new URL(location);
  } catch {
    return false;
  }
  if (
    redirect.origin !== hubOrigin.origin ||
    redirect.pathname !== '/admin/settings/integrations/meta/callback' ||
    !['connected', 'select', 'error'].includes(redirect.searchParams.get('meta')) ||
    [...redirect.searchParams.keys()].some((key) => !['meta', 'code'].includes(key))
  ) return false;
  return !redirect.searchParams.has('code') ||
    DIAGNOSTIC_CODE_PATTERN.test(redirect.searchParams.get('code') ?? '');
}

export function createWorker({
  fetchImpl = (input, init) => fetch(input, init),
  requestImpl = Request,
} = {}) {
  return {
    async fetch(request, env) {
      if (request.method !== 'GET') return reply(405);
      const url = new URL(request.url);
      if (url.pathname !== CALLBACK_PATH) return reply(404);
      if (url.search.length - 1 > MAX_QUERY_BYTES) return reply(400);
      const code = url.searchParams.getAll('code');
      const state = url.searchParams.getAll('state');
      if (
        code.length !== 1 || state.length !== 1 || url.searchParams.size !== 2 ||
        code[0].length < 1 || code[0].length > 4_096 || !STATE_PATTERN.test(state[0])
      ) return reply(400);

      let configuration;
      try {
        configuration = readConfiguration(env);
      } catch {
        return reply(503, { diagnosticCode: 'CONFIG_INVALID' });
      }

      let upstreamRequest;
      try {
        upstreamRequest = new requestImpl(configuration.callbackUrl.toString(), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-meta-callback-ingress-secret': configuration.secret,
          },
          body: JSON.stringify({ code: code[0], state: state[0] }),
          redirect: 'manual',
          signal: AbortSignal.timeout(8_000),
        });
      } catch {
        return reply(502, { diagnosticCode: 'UPSTREAM_REQUEST_BUILD_FAILED' });
      }

      let upstream;
      try {
        upstream = await fetchImpl(upstreamRequest);
      } catch {
        return reply(502, { diagnosticCode: 'UPSTREAM_FETCH_FAILED' });
      }
      if (upstream.status !== 302) {
        return reply(502, {
          diagnosticCode: 'UPSTREAM_NOT_REDIRECT',
          upstreamStatus: upstream.status,
        });
      }
      const location = upstream.headers.get('location');
      if (!location) return reply(502, { diagnosticCode: 'UPSTREAM_LOCATION_MISSING' });
      if (!isSafeRedirect(location, configuration.hubOrigin)) {
        return reply(502, { diagnosticCode: 'UPSTREAM_REDIRECT_REJECTED' });
      }
      return reply(302, { location });
    },
  };
}

export default createWorker();
