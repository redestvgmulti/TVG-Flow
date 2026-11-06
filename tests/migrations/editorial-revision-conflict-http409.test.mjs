import assert from 'node:assert/strict'
import { randomUUID, createHmac } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import test from 'node:test'
import { as, connection, createFixtureDatabase, dropFixtureDatabase, runtimeEnabled } from './2b1-fixture.mjs'

const migration = new URL('../../supabase/migrations/20261106182906_editorial_revision_conflict_http409.sql', import.meta.url)
const signatures = [
  'ap.save_editorial_article_draft(uuid,text,text,uuid,integer)',
  'ap.finalize_editorial_article(uuid,text,text,uuid,integer)',
  'ap.save_editorial_article_draft_v2(uuid,text,text,text,text,text,jsonb,uuid,integer)',
  'ap.finalize_editorial_article_v2(uuid,text,text,text,text,text,jsonb,uuid,integer)',
  'ap.approve_editorial_article_for_render(uuid,integer,uuid)',
]
const conflict = error => error.code === 'PT409' && error.message === 'EDITORIAL_REVISION_CONFLICT'
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

test('editorial revision conflicts preserve ACL, revisions and HTTP liveness', { skip: !runtimeEnabled, timeout: 60000 }, async t => {
  assert.ok(['127.0.0.1', 'localhost'].includes(connection.host), 'Fixture must use local PostgreSQL')
  const ctx = await createFixtureDatabase('tvg_conflict_http409')
  const { client } = ctx
  t.after(() => dropFixtureDatabase(ctx))
  await client.query('CREATE TABLE ap.editorial_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), cliente_id uuid, input_tokens integer, output_tokens integer, model text, prompt_snapshot text)')
  for (const filename of ['20260920002600_editorial_ai_draft_vertical_slice.sql', '20260920153000_editorial_self_review.sql']) {
    await client.query(await readFile(new URL(`../../supabase/migrations/${filename}`, import.meta.url), 'utf8'))
  }

  const definitions = async () => (await client.query(`
    SELECT p.oid::regprocedure::text AS signature, pg_get_functiondef(p.oid) AS definition,
           p.proacl::text AS acl, p.proowner, p.prosecdef, p.proconfig
    FROM pg_proc p WHERE p.oid = ANY($1::regprocedure[]) ORDER BY p.oid
  `, [signatures])).rows
  const before = await definitions()
  await client.query(await readFile(migration, 'utf8'))

  await t.test('only the conflict SQLSTATE changes in all five functions; grants and ownership remain identical', async () => {
    const after = await definitions()
    assert.equal(after.length, 5)
    assert.deepEqual(after.map(row => ({ ...row, definition: row.definition.replace("'PT409'", "'40001'") })), before)
    await client.query(await readFile(migration, 'utf8'))
    assert.deepEqual(await definitions(), after, 'Reapplying the guarded change must be harmless')
  })

  const tenant = id(1), company = id(2), admin = id(3), staff = id(4), otherStaff = id(5)
  const tenantB = id(6), companyB = id(7), adminB = id(8)
  const claims = { sub: staff, role: 'authenticated' }
  await client.query('INSERT INTO public.empresas(id) VALUES ($1),($2)', [company, companyB])
  await client.query('INSERT INTO public.clientes(id,empresa_id) VALUES ($1,$2),($3,$4)', [tenant, company, tenantB, companyB])
  await client.query("INSERT INTO public.profissionais(id,role,nome) VALUES ($1,'admin','Admin fixture'),($2,'staff','Author fixture'),($3,'staff','Other fixture'),($4,'admin','Other tenant fixture')", [admin, staff, otherStaff, adminB])
  await client.query('INSERT INTO public.operational_clients(profissional_id,cliente_id) VALUES ($1,$2),($3,$2),($4,$2),($5,$6)', [admin, tenant, staff, otherStaff, adminB, tenantB])
  await as(client, 'authenticated', { sub: admin, role: 'authenticated' }, 'SELECT ap.set_editorial_workflow_v1_enabled(true)')
  await as(client, 'authenticated', { sub: adminB, role: 'authenticated' }, 'SELECT ap.set_editorial_workflow_v1_enabled(true)')

  const create = async () => {
    const { rows } = await as(client, 'authenticated', claims, "SELECT * FROM ap.start_editorial_article_direct('text',NULL,$1)", [randomUUID()])
    return rows[0].id
  }
  const saveSql = version => version === 'v2'
    ? "SELECT * FROM ap.save_editorial_article_draft_v2($1,'Fixture title','Fixture body long enough','Fixture caption',NULL,NULL,NULL,$2,$3)"
    : "SELECT * FROM ap.save_editorial_article_draft($1,'Fixture title','Fixture body long enough',$2,$3)"
  const finalizeSql = version => version === 'v2'
    ? "SELECT * FROM ap.finalize_editorial_article_v2($1,'Fixture final','Fixture final body','Fixture caption',NULL,NULL,NULL,$2,$3)"
    : "SELECT * FROM ap.finalize_editorial_article($1,'Fixture final','Fixture final body',$2,$3)"

  for (const version of ['legacy', 'v2']) {
    await t.test(`${version}: stale save/finalize/approval rejects without writing; correct revisions and idempotent retries work`, async () => {
      const articleId = await create()
      const initialRequest = randomUUID()
      await as(client, 'authenticated', claims, saveSql(version), [articleId, initialRequest, 0])
      await as(client, 'authenticated', claims, saveSql(version), [articleId, initialRequest, 0])
      await assert.rejects(as(client, 'authenticated', claims, saveSql(version), [articleId, randomUUID(), 0]), conflict)
      await assert.rejects(as(client, 'authenticated', claims, finalizeSql(version), [articleId, randomUUID(), 0]), conflict)
      assert.equal((await client.query('SELECT count(*)::int AS n FROM ap.editorial_article_revisions WHERE article_id=$1', [articleId])).rows[0].n, 1)
      await as(client, 'authenticated', claims, "SELECT * FROM ap.save_editorial_article_production_intent($1,'text','feed',NULL,NULL,NULL,NULL,NULL,NULL,$2)", [articleId, randomUUID()])
      const finalRequest = randomUUID()
      await as(client, 'authenticated', claims, finalizeSql(version), [articleId, finalRequest, 1])
      await as(client, 'authenticated', claims, finalizeSql(version), [articleId, finalRequest, 1])
      await assert.rejects(as(client, 'authenticated', claims, 'SELECT * FROM ap.approve_editorial_article_for_render($1,1,$2)', [articleId, randomUUID()]), conflict)
      const approveRequest = randomUUID()
      await as(client, 'authenticated', claims, 'SELECT * FROM ap.approve_editorial_article_for_render($1,2,$2)', [articleId, approveRequest])
      await as(client, 'authenticated', claims, 'SELECT * FROM ap.approve_editorial_article_for_render($1,2,$2)', [articleId, approveRequest])
      const result = await client.query('SELECT status, (SELECT count(*)::int FROM ap.editorial_article_revisions WHERE article_id=$1) AS revisions FROM ap.editorial_articles WHERE id=$1', [articleId])
      assert.deepEqual(result.rows[0], { status: 'ready_for_render', revisions: 2 })
    })
  }

  await t.test('anonymous, unrelated author and another tenant still cannot mutate the article', async () => {
    const articleId = await create()
    for (const [role, actor, expected] of [
      ['anon', {}, /permission denied/],
      ['authenticated', { sub: otherStaff, role: 'authenticated' }, /FORBIDDEN/],
      ['authenticated', { sub: adminB, role: 'authenticated' }, /ARTICLE_NOT_FOUND/],
    ]) {
      await assert.rejects(as(client, role, actor, saveSql('v2'), [articleId, randomUUID(), 0]), expected)
    }
    assert.equal((await client.query('SELECT count(*)::int AS n FROM ap.editorial_article_revisions WHERE article_id=$1', [articleId])).rows[0].n, 0)
  })

  await t.test('real PostgREST: two simultaneous saves produce one success and one prompt HTTP 409', { skip: !process.env.POSTGREST_BINARY }, async () => {
    const secret = 'local-fixture-only-editorial-http-secret-20261106'
    const httpPort = Number(process.env.POSTGREST_TEST_PORT || 55343)
    const server = spawn(process.env.POSTGREST_BINARY, [], {
      windowsHide: true,
      env: { ...process.env,
        PGRST_DB_URI: `postgres://${encodeURIComponent(connection.user)}:${encodeURIComponent(connection.password)}@127.0.0.1:${connection.port}/${ctx.databaseName}`,
        PGRST_DB_SCHEMAS: 'ap', PGRST_DB_ANON_ROLE: 'anon', PGRST_JWT_SECRET: secret,
        PGRST_SERVER_HOST: '127.0.0.1', PGRST_SERVER_PORT: String(httpPort),
      }, stdio: ['ignore', 'pipe', 'pipe'],
    })
    let serverLog = ''
    server.stdout.on('data', data => { serverLog += data })
    server.stderr.on('data', data => { serverLog += data })
    try {
      let ready = false
      for (let i = 0; i < 60; i++) {
        try { ready = (await fetch(`http://127.0.0.1:${httpPort}/`, { signal: AbortSignal.timeout(500) })).status === 200 } catch { /* Wait only for the isolated local fixture. */ }
        if (ready) break
        if (server.exitCode !== null) throw new Error(`PostgREST fixture exited with ${server.exitCode}: ${serverLog}`)
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      assert.ok(ready, serverLog)
      const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
      const payload = Buffer.from(JSON.stringify({ ...claims, exp: Math.floor(Date.now() / 1000) + 600 })).toString('base64url')
      const signed = `${header}.${payload}`
      const jwt = `${signed}.${createHmac('sha256', secret).update(signed).digest('base64url')}`
      const articleId = await create()
      const call = async title => {
        const started = Date.now()
        const response = await fetch(`http://127.0.0.1:${httpPort}/rpc/save_editorial_article_draft_v2`, {
          method: 'POST', signal: AbortSignal.timeout(5000),
          headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json', 'Content-Profile': 'ap' },
          body: JSON.stringify({ p_article_id: articleId, p_headline: title, p_body: 'Isolated concurrent fixture body.', p_caption: 'Fixture caption', p_context_tag: null, p_category: null, p_location: null, p_request_id: randomUUID(), p_expected_revision_number: 0 }),
        })
        return { status: response.status, body: await response.json(), duration: Date.now() - started }
      }
      const results = await Promise.all([call('Session A'), call('Session B')])
      assert.deepEqual(results.map(row => row.status).sort(), [200, 409], JSON.stringify(results))
      const rejected = results.find(row => row.status === 409)
      assert.equal(rejected.body.code, 'PT409')
      assert.equal(rejected.body.message, 'EDITORIAL_REVISION_CONFLICT')
      assert.ok(rejected.duration < 5000)
      assert.equal((await client.query('SELECT count(*)::int AS n FROM ap.editorial_article_revisions WHERE article_id=$1', [articleId])).rows[0].n, 1)
      assert.equal((await call('Stale session retry')).status, 409, 'Repeating stale input must return a response again')
      assert.equal((await client.query('SELECT count(*)::int AS n FROM ap.editorial_article_revisions WHERE article_id=$1', [articleId])).rows[0].n, 1)
    } finally {
      if (server.exitCode === null) { const exited = once(server, 'exit'); server.kill(); await exited }
    }
  })
})
