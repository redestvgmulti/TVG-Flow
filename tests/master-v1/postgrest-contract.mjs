// PostgREST contract for the AutoPublisher, run against the local Supabase REST
// API. Keys and the JWT secret are read from `supabase status` at runtime so
// nothing sensitive is committed. Seeds its own tenants/user, asserts the REST
// surface (schema exposure, anon lockout, tenant isolation, service_role access,
// RPC reachability, HTTP status codes) and always cleans up.
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'
import test from 'node:test'

const DB = process.env.SUPABASE_DB_CONTAINER || 'supabase_db_sprint-g3'

function status() {
  const raw = execFileSync('npx', ['--yes', 'supabase', 'status', '-o', 'json'], {
    encoding: 'utf8',
    shell: true,
  })
  return JSON.parse(raw)
}

function psql(sql) {
  return execFileSync(
    'docker',
    ['exec', '-i', DB, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q', '-t', '-A', '-c', sql],
    { encoding: 'utf8' },
  ).trim()
}

function b64url(input) {
  return Buffer.from(input).toString('base64url')
}
function mintJwt(secret, payload) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = b64url(JSON.stringify(payload))
  const sig = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url')
  return `${header}.${body}.${sig}`
}

const CLIENTE_A = 'a1a1a1a1-0000-4000-8000-0000000000a1'
const CLIENTE_B = 'b2b2b2b2-0000-4000-8000-0000000000b2'
const USER_A = 'c3c3c3c3-0000-4000-8000-0000000000c3'
const NEWS_A = 'd4d4d4d4-0000-4000-8000-0000000000a1'
const NEWS_B = 'd4d4d4d4-0000-4000-8000-0000000000b2'

const cfg = status()
const API = cfg.API_URL
const ANON = cfg.ANON_KEY
const SVC = cfg.SERVICE_ROLE_KEY
const AUTH = mintJwt(cfg.JWT_SECRET, {
  iss: 'supabase-demo',
  role: 'authenticated',
  aud: 'authenticated',
  sub: USER_A,
  exp: Math.floor(Date.now() / 1000) + 3600,
})

function seed() {
  psql(`
    INSERT INTO public.clientes (id, nome) VALUES
      ('${CLIENTE_A}','REST Tenant A'), ('${CLIENTE_B}','REST Tenant B')
      ON CONFLICT (id) DO NOTHING;
    INSERT INTO auth.users (id, email) VALUES ('${USER_A}','rest-user-a@test.local')
      ON CONFLICT (id) DO NOTHING;
    INSERT INTO public.cliente_profissionais (cliente_id, profissional_id, funcao, ativo)
      VALUES ('${CLIENTE_A}','${USER_A}','editor',true)
      ON CONFLICT (cliente_id, profissional_id, funcao) DO NOTHING;
    INSERT INTO ap.candidate_news (id, cliente_id, status, titulo, url_original) VALUES
      ('${NEWS_A}','${CLIENTE_A}','raw','A news','https://rest.test/a'),
      ('${NEWS_B}','${CLIENTE_B}','raw','B news','https://rest.test/b')
      ON CONFLICT (id) DO NOTHING;
  `)
}

function cleanup() {
  psql(`
    DELETE FROM ap.candidate_news WHERE id IN ('${NEWS_A}','${NEWS_B}');
    DELETE FROM public.cliente_profissionais WHERE cliente_id IN ('${CLIENTE_A}','${CLIENTE_B}');
    DELETE FROM auth.users WHERE id = '${USER_A}';
    DELETE FROM public.clientes WHERE id IN ('${CLIENTE_A}','${CLIENTE_B}');
  `)
}

async function rest(path, { key, token, method = 'GET', profile, body, extra } = {}) {
  const headers = { ...(extra || {}) }
  if (key) headers.apikey = key
  if (token) headers.Authorization = `Bearer ${token}`
  if (profile) {
    headers['Accept-Profile'] = profile
    headers['Content-Profile'] = profile
  }
  if (body) headers['Content-Type'] = 'application/json'
  const res = await fetch(`${API}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined })
  const text = await res.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch { /* non-json */ }
  return { status: res.status, json, text }
}

seed()
test.after(() => cleanup())

test('the ap schema is exposed through Accept-Profile', async () => {
  const r = await rest('/rest/v1/candidate_news?limit=1', { key: SVC, token: SVC, profile: 'ap' })
  assert.equal(r.status, 200, `ap schema should be reachable, got ${r.status} ${r.text}`)
})

test('an unexposed schema is rejected with 406 PGRST106', async () => {
  const r = await rest('/rest/v1/candidate_news?limit=1', { key: SVC, token: SVC, profile: 'does_not_exist' })
  assert.equal(r.status, 406)
  assert.equal(r.json?.code, 'PGRST106')
})

test('anon cannot read protected ap resources (RLS hides all rows)', async () => {
  const r = await rest('/rest/v1/candidate_news?select=id', { key: ANON, token: ANON, profile: 'ap' })
  assert.equal(r.status, 200)
  assert.deepEqual(r.json, [])
})

test('anon cannot write to ap resources', async () => {
  const r = await rest('/rest/v1/candidate_news', {
    key: ANON, token: ANON, profile: 'ap', method: 'POST',
    body: { cliente_id: CLIENTE_A, status: 'raw', titulo: 'hack', url_original: 'https://rest.test/hack' },
  })
  assert.ok(r.status === 401 || r.status === 403, `anon write should be denied, got ${r.status}`)
})

test('an authenticated tenant user sees only its own rows', async () => {
  const r = await rest('/rest/v1/candidate_news?select=id,cliente_id', { key: ANON, token: AUTH, profile: 'ap' })
  assert.equal(r.status, 200)
  const ids = (r.json || []).map((row) => row.cliente_id)
  assert.ok(ids.includes(CLIENTE_A), 'tenant A user should see tenant A rows')
  assert.ok(!ids.includes(CLIENTE_B), 'tenant A user must not see tenant B rows')
})

test('service_role bypasses RLS and sees every tenant', async () => {
  const r = await rest('/rest/v1/candidate_news?select=id,cliente_id&id=in.(' + NEWS_A + ',' + NEWS_B + ')', {
    key: SVC, token: SVC, profile: 'ap',
  })
  assert.equal(r.status, 200)
  assert.equal(r.json.length, 2, 'service_role should see both tenants rows')
})

test('an essential ap RPC is reachable over REST and enforces its execute grant', async () => {
  // anon lacks EXECUTE on the wrapper -> PostgREST denies it.
  const anonCall = await rest('/rest/v1/rpc/create_candidate_with_sponsors', {
    key: ANON, token: ANON, profile: 'ap', method: 'POST',
    body: { p_cliente_id: CLIENTE_A, p_idempotency_key: NEWS_A, p_content_type: 'feed', p_template_set: 'default', p_sponsor_count: 0, p_titulo: 'x' },
  })
  assert.ok(
    anonCall.status === 401 || anonCall.status === 403 || anonCall.status === 404,
    `anon RPC call should be denied, got ${anonCall.status}`,
  )
  // service_role reaches and executes the function; a bogus tenant makes it raise
  // its own domain error (proving it ran), not a 404 routing miss.
  const svcCall = await rest('/rest/v1/rpc/create_candidate_with_sponsors', {
    key: SVC, token: SVC, profile: 'ap', method: 'POST',
    body: { p_cliente_id: '00000000-0000-4000-8000-000000000000', p_idempotency_key: '00000000-0000-4000-8000-0000000000ff', p_content_type: 'feed', p_template_set: 'default', p_sponsor_count: 0, p_titulo: 'x' },
  })
  assert.notEqual(svcCall.status, 404, 'RPC endpoint should exist for service_role')
  assert.ok(svcCall.status >= 400 && svcCall.status < 500, `domain error should be a 4xx, got ${svcCall.status} ${svcCall.text}`)
})

test('a request without credentials cannot read protected tenant data', async () => {
  // The local gateway treats a keyless request as anon rather than rejecting it,
  // so the security guarantee is that no protected rows leak, not a specific code.
  const r = await rest('/rest/v1/candidate_news?select=id', { profile: 'ap' })
  assert.equal(r.status, 200)
  assert.deepEqual(r.json, [], 'a keyless (anon) request must not expose tenant rows')
})

test('a missing relation returns 404', async () => {
  const r = await rest('/rest/v1/relation_that_does_not_exist?limit=1', { key: SVC, token: SVC, profile: 'ap' })
  assert.equal(r.status, 404)
})
