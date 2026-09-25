const CALLBACK_PATH = '/meta/oauth/callback';
const STATE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const RESPONSE_HEADERS = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'none'",
  'X-Content-Type-Options': 'nosniff',
};

function reply(statusCode, location) {
  return {
    statusCode,
    headers: location ? { ...RESPONSE_HEADERS, Location: location } : RESPONSE_HEADERS,
    body: '',
  };
}

function readConfiguration(env) {
  const callbackUrl = new URL(env.SUPABASE_META_CALLBACK_URL);
  const hubOrigin = new URL(env.TVG_HUB_ORIGIN);
  const secret = env.META_CALLBACK_INGRESS_SECRET;
  if (
    callbackUrl.protocol !== 'https:' || callbackUrl.search || callbackUrl.hash ||
    !callbackUrl.pathname.endsWith('/functions/v1/ap-meta-oauth-callback') ||
    callbackUrl.username || callbackUrl.password ||
    hubOrigin.protocol !== 'https:' || hubOrigin.pathname !== '/' ||
    hubOrigin.search || hubOrigin.hash || hubOrigin.username || hubOrigin.password ||
    !secret || secret.length < 32
  ) throw new Error('TERMINATOR_CONFIGURATION_INVALID');
  return { callbackUrl, hubOrigin, secret };
}

export function createHandler({ fetchImpl = fetch, env = process.env, log = console.info } = {}) {
  return async function handler(event) {
    if (event?.requestContext?.http?.method !== 'GET') return reply(405);
    if (event.rawPath !== CALLBACK_PATH) return reply(404);
    const params = new URLSearchParams(event.rawQueryString ?? '');
    const code = params.getAll('code');
    const state = params.getAll('state');
    if (
      code.length !== 1 || state.length !== 1 || params.size !== 2 ||
      code[0].length < 1 || code[0].length > 4096 ||
      !STATE_PATTERN.test(state[0]) ||
      (event.rawQueryString ?? '').length > 8192
    ) return reply(400);

    let configuration;
    try {
      configuration = readConfiguration(env);
    } catch {
      return reply(503);
    }

    try {
      const upstream = await fetchImpl(configuration.callbackUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-meta-callback-ingress-secret': configuration.secret,
        },
        body: JSON.stringify({ code: code[0], state: state[0] }),
        redirect: 'manual',
        signal: AbortSignal.timeout(8_000),
      });
      const location = upstream.headers.get('location');
      if (upstream.status !== 302 || !location) return reply(502);
      const redirect = new URL(location);
      if (
        redirect.origin !== configuration.hubOrigin.origin ||
        redirect.pathname !== '/admin/settings/integrations/meta/callback' ||
        !['connected', 'select', 'error'].includes(redirect.searchParams.get('meta')) ||
        [...redirect.searchParams.keys()].some((key) => !['meta', 'code'].includes(key)) ||
        (redirect.searchParams.has('code') &&
          !/^META_[A-Z_]+$/.test(redirect.searchParams.get('code') ?? ''))
      ) return reply(502);
      log('META_CALLBACK_FORWARDED');
      return reply(302, redirect.toString());
    } catch {
      return reply(502);
    }
  };
}

export const handler = createHandler();
