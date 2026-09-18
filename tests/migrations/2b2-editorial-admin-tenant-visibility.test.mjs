import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { createFixtureDatabase, dropFixtureDatabase, as, runtimeEnabled } from './2b1-fixture.mjs'

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

// Regression test: 2B.1's own fix for the INNER JOIN bug (which excluded
// direct-origin articles from list_my_editorial_articles) was accidentally
// based on R1's migration-4 body, which always filters by
// responsible_user_id -- losing R1's original migration-3 admin-sees-all
// branch. This proves the 2B.2.1 correction (a new migration, not a rewrite
// of the committed 2B.1 one) restores it without reintroducing the JOIN bug.
test('2B.2.1 admin sees all tenant articles; staff scope remains restricted', { skip: !runtimeEnabled }, async (t) => {
  const empresa = id(1), cliente = id(2), admin = id(3), staffA = id(4), staffB = id(5)
  const adminClaims = { sub: admin, role: 'authenticated', app_role: 'admin' }
  const staffAClaims = { sub: staffA, role: 'authenticated' }
  const staffBClaims = { sub: staffB, role: 'authenticated' }
  const ctx = await createFixtureDatabase('tvg_2b2_admin_visibility')
  const { client } = ctx
  t.after(() => dropFixtureDatabase(ctx))

  await client.query(`INSERT INTO public.empresas(id) VALUES ($1)`, [empresa])
  await client.query(`INSERT INTO public.clientes(id, empresa_id) VALUES ($1, $2)`, [cliente, empresa])
  await client.query(
    `INSERT INTO public.profissionais(id, role, nome) VALUES ($1,'admin','Admin'), ($2,'staff','Staff A'), ($3,'staff','Staff B')`,
    [admin, staffA, staffB])
  await client.query(
    `INSERT INTO public.operational_clients(profissional_id, cliente_id) VALUES ($1,$2),($3,$4),($5,$6)`,
    [admin, cliente, staffA, cliente, staffB, cliente])
  await as(client, 'authenticated', adminClaims, 'SELECT ap.set_editorial_workflow_v1_enabled(true)')

  const articleA = await as(client, 'authenticated', staffAClaims,
    `SELECT * FROM ap.start_editorial_article_direct('text', NULL, $1)`, [randomUUID()])
  const articleB = await as(client, 'authenticated', staffBClaims,
    `SELECT * FROM ap.start_editorial_article_direct('link', 'https://example.com/b', $1)`, [randomUUID()])

  await t.test('staff A sees only their own article, not staff B\'s', async () => {
    const r = await as(client, 'authenticated', staffAClaims, 'SELECT * FROM ap.list_my_editorial_articles()')
    const ids = r.rows.map((row) => row.article_id)
    assert.ok(ids.includes(articleA.rows[0].id))
    assert.ok(!ids.includes(articleB.rows[0].id))
  })

  await t.test('staff B sees only their own article, not staff A\'s', async () => {
    const r = await as(client, 'authenticated', staffBClaims, 'SELECT * FROM ap.list_my_editorial_articles()')
    const ids = r.rows.map((row) => row.article_id)
    assert.ok(ids.includes(articleB.rows[0].id))
    assert.ok(!ids.includes(articleA.rows[0].id))
  })

  await t.test('admin sees both articles from the tenant, including the direct-origin one', async () => {
    const r = await as(client, 'authenticated', adminClaims, 'SELECT * FROM ap.list_my_editorial_articles()')
    const ids = r.rows.map((row) => row.article_id)
    assert.ok(ids.includes(articleA.rows[0].id))
    assert.ok(ids.includes(articleB.rows[0].id))
    // The link-origin article has no news_backlog row -- confirms the LEFT
    // JOIN fix from 2B.1 survives this correction (admin branch included).
    const rowB = r.rows.find((row) => row.article_id === articleB.rows[0].id)
    assert.equal(rowB.news_backlog_id, null)
  })

  await t.test('a different tenant\'s admin sees nothing from this one', async () => {
    const otherEmpresa = id(90), otherCliente = id(91), foreignAdmin = id(92)
    await client.query(`INSERT INTO public.empresas(id) VALUES ($1)`, [otherEmpresa])
    await client.query(`INSERT INTO public.clientes(id, empresa_id) VALUES ($1,$2)`, [otherCliente, otherEmpresa])
    await client.query(`INSERT INTO public.profissionais(id, role, nome) VALUES ($1,'admin','Foreign Admin')`, [foreignAdmin])
    await client.query(`INSERT INTO public.operational_clients(profissional_id, cliente_id) VALUES ($1,$2)`, [foreignAdmin, otherCliente])
    await as(client, 'authenticated', { sub: foreignAdmin, role: 'authenticated', app_role: 'admin' },
      'SELECT ap.set_editorial_workflow_v1_enabled(true)')
    const r = await as(client, 'authenticated', { sub: foreignAdmin, role: 'authenticated', app_role: 'admin' },
      'SELECT * FROM ap.list_my_editorial_articles()')
    assert.equal(r.rowCount, 0)
  })
})
