import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { createFixtureDatabase, dropFixtureDatabase, as, runtimeEnabled } from './2b1-fixture.mjs'

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

test('2B.2.1 ap.get_editorial_article_for_edit on ephemeral PostgreSQL', { skip: !runtimeEnabled }, async (t) => {
  const empresa = id(1), cliente = id(2), admin = id(3), staff = id(4), otherStaff = id(5)
  const adminClaims = { sub: admin, role: 'authenticated', app_role: 'admin' }
  const staffClaims = { sub: staff, role: 'authenticated' }
  const otherStaffClaims = { sub: otherStaff, role: 'authenticated' }
  const ctx = await createFixtureDatabase('tvg_2b2_article_for_edit')
  const { client } = ctx
  t.after(() => dropFixtureDatabase(ctx))

  await client.query(`INSERT INTO public.empresas(id) VALUES ($1)`, [empresa])
  await client.query(`INSERT INTO public.clientes(id, empresa_id) VALUES ($1, $2)`, [cliente, empresa])
  await client.query(
    `INSERT INTO public.profissionais(id, role, nome) VALUES ($1,'admin','Admin'), ($2,'staff','Staff'), ($3,'staff','Other Staff')`,
    [admin, staff, otherStaff])
  await client.query(
    `INSERT INTO public.operational_clients(profissional_id, cliente_id) VALUES ($1,$2),($3,$4),($5,$6)`,
    [admin, cliente, staff, cliente, otherStaff, cliente])
  await as(client, 'authenticated', adminClaims, 'SELECT ap.set_editorial_workflow_v1_enabled(true)')

  const created = await as(client, 'authenticated', staffClaims,
    `SELECT * FROM ap.start_editorial_article_direct('text', NULL, $1)`, [randomUUID()])
  const articleId = created.rows[0].id
  await as(client, 'authenticated', staffClaims,
    `SELECT * FROM ap.save_editorial_article_draft($1, 'Meu rascunho', 'Corpo do rascunho', $2)`, [articleId, randomUUID()])

  await t.test('the responsible author reads back their own draft text', async () => {
    const r = await as(client, 'authenticated', staffClaims,
      `SELECT * FROM ap.get_editorial_article_for_edit($1)`, [articleId])
    assert.equal(r.rowCount, 1)
    assert.equal(r.rows[0].headline, 'Meu rascunho')
    assert.equal(r.rows[0].body, 'Corpo do rascunho')
    assert.equal(r.rows[0].revision_number, 1)
    assert.equal(r.rows[0].status, 'editing')
  })

  await t.test('admin reads the same draft even though they are not the responsible user', async () => {
    const r = await as(client, 'authenticated', adminClaims,
      `SELECT * FROM ap.get_editorial_article_for_edit($1)`, [articleId])
    assert.equal(r.rowCount, 1)
    assert.equal(r.rows[0].headline, 'Meu rascunho')
  })

  await t.test('a staff member with no relationship to the article is forbidden', async () => {
    await assert.rejects(
      as(client, 'authenticated', otherStaffClaims,
        `SELECT * FROM ap.get_editorial_article_for_edit($1)`, [articleId]),
      /FORBIDDEN/
    )
  })

  await t.test('unauthenticated calls fail closed', async () => {
    await assert.rejects(
      as(client, 'authenticated', {}, `SELECT * FROM ap.get_editorial_article_for_edit($1)`, [articleId]),
      /AUTH_REQUIRED/
    )
  })

  await t.test('a nonexistent article id reports ARTICLE_NOT_FOUND, not a silent empty result', async () => {
    await assert.rejects(
      as(client, 'authenticated', staffClaims,
        `SELECT * FROM ap.get_editorial_article_for_edit($1)`, [randomUUID()]),
      /ARTICLE_NOT_FOUND/
    )
  })

  await t.test('an article in ready_for_render remains readable here (not only through the service-role claim RPC)', async () => {
    await as(client, 'authenticated', staffClaims,
      `SELECT * FROM ap.save_editorial_article_production_intent($1,'text','feed',NULL,NULL,NULL,NULL,NULL,NULL,$2)`,
      [articleId, randomUUID()])
    await as(client, 'authenticated', staffClaims,
      `SELECT * FROM ap.finalize_editorial_article($1, 'Final', 'Corpo final', $2, 1)`, [articleId, randomUUID()])
    await as(client, 'authenticated', adminClaims,
      `SELECT * FROM ap.approve_editorial_article_for_render($1, 2, $2)`, [articleId, randomUUID()])

    const r = await as(client, 'authenticated', staffClaims,
      `SELECT * FROM ap.get_editorial_article_for_edit($1)`, [articleId])
    assert.equal(r.rows[0].status, 'ready_for_render')
    assert.equal(r.rows[0].headline, 'Final')
    assert.equal(r.rows[0].content_type, 'feed')
  })

  await t.test('tenant isolation: a caller from a different tenant cannot resolve the article at all', async () => {
    const otherEmpresa = id(90), otherCliente = id(91), foreignAdmin = id(92)
    await client.query(`INSERT INTO public.empresas(id) VALUES ($1)`, [otherEmpresa])
    await client.query(`INSERT INTO public.clientes(id, empresa_id) VALUES ($1,$2)`, [otherCliente, otherEmpresa])
    await client.query(`INSERT INTO public.profissionais(id, role, nome) VALUES ($1,'admin','Foreign Admin')`, [foreignAdmin])
    await client.query(`INSERT INTO public.operational_clients(profissional_id, cliente_id) VALUES ($1,$2)`, [foreignAdmin, otherCliente])
    await assert.rejects(
      as(client, 'authenticated', { sub: foreignAdmin, role: 'authenticated', app_role: 'admin' },
        `SELECT * FROM ap.get_editorial_article_for_edit($1)`, [articleId]),
      /ARTICLE_NOT_FOUND/
    )
  })
})
