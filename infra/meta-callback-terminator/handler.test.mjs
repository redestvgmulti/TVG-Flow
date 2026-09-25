import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHandler } from './handler.mjs';

const state = 'x'.repeat(43);
const code = 'fixture-oauth-code-do-not-log';
const secret = 'fixture-dedicated-ingress-secret-at-least-32-chars';
const env = {
  SUPABASE_META_CALLBACK_URL: 'https://project.test/functions/v1/ap-meta-oauth-callback',
  TVG_HUB_ORIGIN: 'https://tvgflow.test',
  META_CALLBACK_INGRESS_SECRET: secret,
};
const event = (rawQueryString = `code=${code}&state=${state}`, method = 'GET') => ({
  requestContext: { http: { method } },
  rawPath: '/meta/oauth/callback',
  rawQueryString,
});

test('GET terminator forwards a JSON POST to the bare Supabase callback path', async () => {
  const logs = [];
  let calls = 0;
  const handler = createHandler({ env, log: (...parts) => logs.push(parts), fetchImpl: async (url, init) => {
    calls++;
    assert.equal(url.search, '');
    assert.equal(init.method, 'POST');
    assert.equal(init.redirect, 'manual');
    assert.equal(init.headers['x-meta-callback-ingress-secret'], secret);
    assert.deepEqual(JSON.parse(init.body), { code, state });
    return new Response(null, { status: 302, headers: { Location: 'https://tvgflow.test/admin/settings/integrations/meta/callback?meta=connected' } });
  } });
  const response = await handler(event());
  assert.equal(calls, 1);
  assert.equal(response.statusCode, 302);
  assert.equal(response.headers.Location, 'https://tvgflow.test/admin/settings/integrations/meta/callback?meta=connected');
  assert.equal(response.headers['Referrer-Policy'], 'no-referrer');
  const persisted = JSON.stringify(logs);
  assert.equal(persisted.includes(code), false);
  assert.equal(persisted.includes(state), false);
  assert.equal(persisted.includes(secret), false);
});

test('invalid method, state, duplicate code, and excessive query never reach Supabase', async () => {
  const handler = createHandler({ env, fetchImpl: () => { throw new Error('Unexpected upstream call'); } });
  assert.equal((await handler(event(undefined, 'POST'))).statusCode, 405);
  assert.equal((await handler(event(`code=${code}&state=invalid`))).statusCode, 400);
  assert.equal((await handler(event(`code=${code}&code=again&state=${state}`))).statusCode, 400);
  assert.equal((await handler(event(`code=${'x'.repeat(8200)}&state=${state}`))).statusCode, 400);
});

test('upstream failure or unexpected redirect is never exposed to the browser', async () => {
  const failed = createHandler({ env, fetchImpl: async () => { throw new Error(`private ${code} ${state}`); } });
  assert.equal((await failed(event())).statusCode, 502);
  const escaped = createHandler({ env, fetchImpl: async () => new Response(null, { status: 302, headers: { Location: 'https://other.test/' } }) });
  assert.equal((await escaped(event())).statusCode, 502);
  const leakedCode = createHandler({ env, fetchImpl: async () => new Response(null, { status: 302, headers: { Location: `https://tvgflow.test/admin/settings/integrations/meta/callback?code=${code}` } }) });
  assert.equal((await leakedCode(event())).statusCode, 502);
  const leakedTenant = createHandler({ env, fetchImpl: async () => new Response(null, { status: 302, headers: { Location: 'https://tvgflow.test/admin/settings/integrations/meta/callback?meta=connected&tenant=fixture-tenant' } }) });
  assert.equal((await leakedTenant(event())).statusCode, 502);
});

test('controlled state is single-use across terminator and internal POST', async () => {
  const liveStates = new Set([state]);
  const posts = [];
  const handler = createHandler({ env, log: () => {}, fetchImpl: async (url, init) => {
    posts.push({ pathname: url.pathname, query: url.search });
    const body = JSON.parse(init.body);
    if (!liveStates.delete(body.state)) {
      return new Response(null, { status: 302, headers: { Location: 'https://tvgflow.test/admin/settings/integrations/meta/callback?meta=error&code=META_OAUTH_STATE_INVALID' } });
    }
    return new Response(null, { status: 302, headers: { Location: 'https://tvgflow.test/admin/settings/integrations/meta/callback?meta=connected' } });
  } });
  assert.match((await handler(event())).headers.Location, /meta=connected/);
  assert.match((await handler(event())).headers.Location, /META_OAUTH_STATE_INVALID/);
  assert.deepEqual(posts, [
    { pathname: '/functions/v1/ap-meta-oauth-callback', query: '' },
    { pathname: '/functions/v1/ap-meta-oauth-callback', query: '' },
  ]);
});
