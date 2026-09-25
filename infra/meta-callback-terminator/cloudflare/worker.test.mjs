import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { createWorker } from './src/index.mjs';

const state = 'x'.repeat(43);
const code = 'fixture-oauth-code-not-logged';
const secret = 'fixture-dedicated-ingress-secret-at-least-32-chars';
const env = {
  SUPABASE_META_CALLBACK_URL: 'https://gyooxmpyxncrezjiljrj.supabase.co/functions/v1/ap-meta-oauth-callback',
  TVG_HUB_ORIGIN: 'https://tvgflow.vercel.app',
  META_CALLBACK_INGRESS_SECRET: secret,
};
const request = (query = `code=${code}&state=${state}`, method = 'GET', path = '/meta/oauth/callback') =>
  new Request(`https://meta-oauth-callback.redestvgmulti.workers.dev${path}${query === undefined ? '' : `?${query}`}`, { method });

test('valid GET forwards a JSON POST to the bare Supabase callback URL', async () => {
  let call;
  const worker = createWorker({ fetchImpl: async (url, init) => {
    call = { url, init };
    return new Response(null, { status: 302, headers: { Location: 'https://tvgflow.vercel.app/admin/settings/integrations/meta/callback?meta=connected' } });
  } });
  const response = await worker.fetch(request(), env);
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), 'https://tvgflow.vercel.app/admin/settings/integrations/meta/callback?meta=connected');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(call.url.search, '');
  assert.equal(call.init.method, 'POST');
  assert.equal(call.init.redirect, 'manual');
  assert.equal(call.init.headers['x-meta-callback-ingress-secret'], secret);
  assert.deepEqual(JSON.parse(call.init.body), { code, state });
});

test('wrong method, path, malformed state, duplicate or extra query are rejected before forwarding', async () => {
  const worker = createWorker({ fetchImpl: () => { throw new Error('upstream must not run'); } });
  assert.equal((await worker.fetch(request(undefined, 'POST'), env)).status, 405);
  assert.equal((await worker.fetch(request('', 'GET', '/other'), env)).status, 404);
  assert.equal((await worker.fetch(request(`code=${code}&state=invalid`), env)).status, 400);
  assert.equal((await worker.fetch(request(`code=${code}&code=again&state=${state}`), env)).status, 400);
  assert.equal((await worker.fetch(request(`code=${code}&state=${state}&extra=1`), env)).status, 400);
  assert.equal((await worker.fetch(request(`code=${code}&state=${'x'.repeat(8_200)}`), env)).status, 400);
});

test('invalid configuration and upstream failures fail closed', async () => {
  const worker = createWorker({ fetchImpl: async () => { throw new Error('network failure'); } });
  assert.equal((await worker.fetch(request(), { ...env, TVG_HUB_ORIGIN: 'https://other.test' })).status, 503);
  assert.equal((await worker.fetch(request(), env)).status, 502);
});

test('only allowlisted final redirects are exposed', async () => {
  const location = (value) => createWorker({ fetchImpl: async () => new Response(null, { status: 302, headers: { Location: value } }) });
  assert.equal((await location('https://other.test/').fetch(request(), env)).status, 502);
  assert.equal((await location('https://tvgflow.vercel.app/admin/settings/integrations/meta/callback?meta=connected&tenant=fixture').fetch(request(), env)).status, 502);
  assert.equal((await location(`https://tvgflow.vercel.app/admin/settings/integrations/meta/callback?meta=error&code=${code}`).fetch(request(), env)).status, 502);
  const safe = await location('https://tvgflow.vercel.app/admin/settings/integrations/meta/callback?meta=error&code=META_OAUTH_STATE_INVALID').fetch(request(), env);
  assert.equal(safe.status, 302);
});

test('source has no console logging and the committed config disables logs and traces', async () => {
  const [source, config] = await Promise.all([
    readFile(new URL('./src/index.mjs', import.meta.url), 'utf8'),
    readFile(new URL('./wrangler.jsonc', import.meta.url), 'utf8'),
  ]);
  assert.equal(/console\s*\./.test(source), false);
  assert.match(config, /"logs"\s*:\s*\{\s*"enabled"\s*:\s*false\s*\}/);
  assert.match(config, /"traces"\s*:\s*\{\s*"enabled"\s*:\s*false\s*\}/);
  assert.equal(source.includes(secret), false);
  assert.equal(source.includes(code), false);
  assert.equal(source.includes(state), false);
});
