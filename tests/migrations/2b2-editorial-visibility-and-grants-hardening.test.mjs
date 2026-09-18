import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { createFixtureDatabase, dropFixtureDatabase, as, runtimeEnabled } from './2b1-fixture.mjs'

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

// Post-2B.2.3 integrated-audit fix, verified here against real ephemeral
// PostgreSQL: (1) an editorial article must remain visible/listable after
// the tenant's feature flag is turned off -- the flag gates new creation,
// never visibility of work that already exists -- and (2)
// save_editorial_article_draft/finalize_editorial_article (5-arg forms) must
// not be executable by anon/PUBLIC by Postgres's own default-grant behavior.
test('flag OFF never hides an editorial article that already existed', { skip: !runtimeEnabled }, async (t) => {
  const empresa = id(1), cliente = id(2), admin = id(3), staff = id(4), otherStaff = id(5)
  const adminClaims = { sub: admin, role: 'authenticated', app_role: 'admin' }
  const staffClaims = { sub: staff, role: 'authenticated' }
  const otherStaffClaims = { sub: otherStaff, role: 'authenticated' }
  const ctx = await createFixtureDatabase('tvg_2b2_flagoff_visibility')
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

  let articleId
  await t.test('flag ON: staff creates and drafts an article, it is listable by author and admin', async () => {
    await as(client, 'authenticated', adminClaims, 'SELECT ap.set_editorial_workflow_v1_enabled(true)')
    const created = await as(client, 'authenticated', staffClaims,
      `SELECT * FROM ap.start_editorial_article_direct('text', NULL, $1)`, [randomUUID()])
    articleId = created.rows[0].id
    await as(client, 'authenticated', staffClaims,
      `SELECT * FROM ap.save_editorial_article_draft($1, 'Titulo real', 'Corpo real da materia, com conteudo suficiente', $2)`,
      [articleId, randomUUID()])

    const listStaff = await as(client, 'authenticated', staffClaims, 'SELECT * FROM ap.list_my_editorial_articles()')
    assert.ok(listStaff.rows.some(row => row.article_id === articleId))
    const listAdmin = await as(client, 'authenticated', adminClaims, 'SELECT * FROM ap.list_my_editorial_articles()')
    assert.ok(listAdmin.rows.some(row => row.article_id === articleId))
  })

  await t.test('flag OFF: the same article is still listable by its author and by admin -- the critical regression check', async () => {
    await as(client, 'authenticated', adminClaims, 'SELECT ap.set_editorial_workflow_v1_enabled(false)')

    const listStaff = await as(client, 'authenticated', staffClaims, 'SELECT * FROM ap.list_my_editorial_articles()')
    assert.ok(listStaff.rows.some(row => row.article_id === articleId),
      'the article must remain visible to its author after the flag is turned off')

    const listAdmin = await as(client, 'authenticated', adminClaims, 'SELECT * FROM ap.list_my_editorial_articles()')
    assert.ok(listAdmin.rows.some(row => row.article_id === articleId),
      'the article must remain visible to the tenant admin after the flag is turned off')

    const direct = await as(client, 'authenticated', staffClaims,
      'SELECT * FROM ap.get_editorial_article_for_edit($1)', [articleId])
    assert.equal(direct.rows[0].headline, 'Titulo real', 'the content itself was never touched by the flag')
  })

  await t.test('flag OFF: a staff member with no relationship to the article still cannot see it', async () => {
    const list = await as(client, 'authenticated', otherStaffClaims, 'SELECT * FROM ap.list_my_editorial_articles()')
    assert.ok(!list.rows.some(row => row.article_id === articleId))
  })

  await t.test('flag OFF: cross-tenant admin still sees nothing', async () => {
    const otherEmpresa = id(90), otherCliente = id(91), foreignAdmin = id(92)
    await client.query(`INSERT INTO public.empresas(id) VALUES ($1)`, [otherEmpresa])
    await client.query(`INSERT INTO public.clientes(id, empresa_id) VALUES ($1,$2)`, [otherCliente, otherEmpresa])
    await client.query(`INSERT INTO public.profissionais(id, role, nome) VALUES ($1,'admin','Foreign Admin')`, [foreignAdmin])
    await client.query(`INSERT INTO public.operational_clients(profissional_id, cliente_id) VALUES ($1,$2)`, [foreignAdmin, otherCliente])
    const list = await as(client, 'authenticated', { sub: foreignAdmin, role: 'authenticated', app_role: 'admin' },
      'SELECT * FROM ap.list_my_editorial_articles()')
    assert.equal(list.rowCount, 0)
  })

  await t.test('flag OFF: new article creation is still blocked (the flag correctly continues to gate writes)', async () => {
    await assert.rejects(
      as(client, 'authenticated', staffClaims,
        `SELECT * FROM ap.start_editorial_article_direct('text', NULL, $1)`, [randomUUID()]),
      /EDITORIAL_WORKFLOW_DISABLED/,
    )
    await assert.rejects(
      as(client, 'authenticated', staffClaims,
        `SELECT * FROM ap.save_editorial_article_draft($1, 'x', 'y-body-long-enough', $2)`, [articleId, randomUUID()]),
      /EDITORIAL_WORKFLOW_DISABLED/,
    )
  })
})

test('save_editorial_article_draft / finalize_editorial_article are not executable by anon or PUBLIC', { skip: !runtimeEnabled }, async (t) => {
  const empresa = id(1), cliente = id(2), admin = id(3), staff = id(4)
  const staffClaims = { sub: staff, role: 'authenticated' }
  const ctx = await createFixtureDatabase('tvg_2b2_grants_hardening')
  const { client } = ctx
  t.after(() => dropFixtureDatabase(ctx))

  await client.query(`INSERT INTO public.empresas(id) VALUES ($1)`, [empresa])
  await client.query(`INSERT INTO public.clientes(id, empresa_id) VALUES ($1, $2)`, [cliente, empresa])
  await client.query(`INSERT INTO public.profissionais(id, role, nome) VALUES ($1,'admin','Admin'), ($2,'staff','Staff')`, [admin, staff])
  await client.query(`INSERT INTO public.operational_clients(profissional_id, cliente_id) VALUES ($1,$2),($3,$4)`, [admin, cliente, staff, cliente])
  await as(client, 'authenticated', { sub: admin, role: 'authenticated', app_role: 'admin' }, 'SELECT ap.set_editorial_workflow_v1_enabled(true)')

  await t.test('pg_catalog privilege check: anon=false, authenticated=true, service_role=false for both RPCs', async () => {
    const { rows } = await client.query(`
      SELECT p.proname,
             has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_execute,
             has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute,
             has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_can_execute,
             has_function_privilege('public', p.oid, 'EXECUTE') AS public_can_execute
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'ap'
        AND p.proname IN ('save_editorial_article_draft', 'finalize_editorial_article')
        AND pg_catalog.pg_get_function_identity_arguments(p.oid) = 'p_article_id uuid, p_headline text, p_body text, p_request_id uuid, p_expected_revision_number integer'
    `)
    assert.equal(rows.length, 2, 'both 5-arg functions must exist')
    for (const row of rows) {
      assert.equal(row.anon_can_execute, false, `${row.proname}: anon must not be able to execute`)
      assert.equal(row.public_can_execute, false, `${row.proname}: PUBLIC must not be able to execute`)
      assert.equal(row.service_role_can_execute, false, `${row.proname}: service_role must not be able to execute (browser-facing only, not a worker RPC)`)
      assert.equal(row.authenticated_can_execute, true, `${row.proname}: authenticated must be able to execute`)
    }
  })

  await t.test('functional proof: anon is rejected by PostgreSQL itself (permission denied), not merely by the function\'s own auth.uid() check', async () => {
    await assert.rejects(
      as(client, 'anon', {}, `SELECT * FROM ap.save_editorial_article_draft($1, 'x', 'y-body-long-enough', $2)`, [randomUUID(), randomUUID()]),
      /permission denied for function save_editorial_article_draft/,
    )
    await assert.rejects(
      as(client, 'anon', {}, `SELECT * FROM ap.finalize_editorial_article($1, 'x', 'y-body-long-enough', $2)`, [randomUUID(), randomUUID()]),
      /permission denied for function finalize_editorial_article/,
    )
  })

  await t.test('authenticated can still exercise the RPCs end to end (the fix did not change business logic)', async () => {
    const created = await as(client, 'authenticated', staffClaims,
      `SELECT * FROM ap.start_editorial_article_direct('text', NULL, $1)`, [randomUUID()])
    const articleId = created.rows[0].id
    const saved = await as(client, 'authenticated', staffClaims,
      `SELECT * FROM ap.save_editorial_article_draft($1, 'Titulo', 'Corpo com conteudo suficiente', $2)`,
      [articleId, randomUUID()])
    assert.equal(saved.rows[0].status, 'editing')

    await as(client, 'authenticated', staffClaims,
      `SELECT * FROM ap.save_editorial_article_production_intent($1,'text','feed',NULL,NULL,NULL,NULL,NULL,NULL,$2)`,
      [articleId, randomUUID()])
    const finalized = await as(client, 'authenticated', staffClaims,
      `SELECT * FROM ap.finalize_editorial_article($1, 'Titulo final', 'Corpo final com conteudo', $2, 1)`,
      [articleId, randomUUID()])
    assert.equal(finalized.rows[0].status, 'content_final')
  })
})
