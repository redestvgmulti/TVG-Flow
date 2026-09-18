import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { createFixtureDatabase, dropFixtureDatabase, as, runtimeEnabled } from './2b1-fixture.mjs'

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

test('2B.1 backlog <-> editorial article exclusivity on ephemeral PostgreSQL', { skip: !runtimeEnabled }, async (t) => {
  const empresa = id(1), cliente = id(2), admin = id(3), staff = id(4)
  const adminClaims = { sub: admin, role: 'authenticated', app_role: 'admin' }
  const staffClaims = { sub: staff, role: 'authenticated' }
  const serviceClaims = { role: 'service_role' }
  const ctx = await createFixtureDatabase('tvg_2b1_exclusivity')
  const { client } = ctx
  t.after(() => dropFixtureDatabase(ctx))

  await client.query(`INSERT INTO public.empresas(id) VALUES ($1)`, [empresa])
  await client.query(`INSERT INTO public.clientes(id, empresa_id) VALUES ($1, $2)`, [cliente, empresa])
  await client.query(`INSERT INTO public.profissionais(id, role, nome) VALUES ($1,'admin','Admin'), ($2,'staff','Staff')`, [admin, staff])
  await client.query(`INSERT INTO public.operational_clients(profissional_id, cliente_id) VALUES ($1,$2),($3,$4)`, [admin, cliente, staff, cliente])
  await as(client, 'authenticated', adminClaims, 'SELECT ap.set_editorial_workflow_v1_enabled(true)')

  await t.test('R1 claims a backlog item first: legacy assert and link are both refused', async () => {
    const backlogId = id(10)
    await client.query(
      `INSERT INTO ap.news_backlog(id, cliente_id, status, titulo, url_original, adopted_by_user_id, adopted_at)
       VALUES ($1,$2,'adopted','Pauta A','https://example.com/a',$3,now())`,
      [backlogId, cliente, staff])

    const started = await as(client, 'authenticated', staffClaims,
      `SELECT * FROM ap.start_editorial_article_from_backlog($1, $2)`, [backlogId, randomUUID()])
    assert.equal(started.rows[0].status, 'draft')
    assert.equal(started.rows[0].origin_type, 'news_backlog')

    // Called with the acting user's own JWT in production (ap-employee-generator
    // uses the user client here, the service client only for the link step).
    await assert.rejects(
      as(client, 'authenticated', staffClaims,
        `SELECT * FROM ap.assert_news_backlog_production_access($1, $2, 'https://example.com/a')`, [backlogId, cliente]),
      /BACKLOG_EDITORIAL_ARTICLE_ACTIVE/
    )
    await assert.rejects(
      as(client, 'service_role', serviceClaims,
        `SELECT * FROM ap.link_news_backlog_candidate($1, $2, $3, $4, 'https://example.com/a')`,
        [backlogId, cliente, randomUUID(), staff]),
      /BACKLOG_EDITORIAL_ARTICLE_ACTIVE/
    )
  })

  await t.test('an abandoned R1 article releases the backlog item back to the legacy path', async () => {
    const backlogId = id(20)
    await client.query(
      `INSERT INTO ap.news_backlog(id, cliente_id, status, titulo, url_original, adopted_by_user_id, adopted_at)
       VALUES ($1,$2,'adopted','Pauta C','https://example.com/c',$3,now())`,
      [backlogId, cliente, staff])
    const started = await as(client, 'authenticated', staffClaims,
      `SELECT * FROM ap.start_editorial_article_from_backlog($1, $2)`, [backlogId, randomUUID()])
    await as(client, 'authenticated', staffClaims,
      `SELECT * FROM ap.abandon_editorial_article($1, 'no longer needed', $2)`, [started.rows[0].id, randomUUID()])

    const backlogAfter = await client.query('SELECT status FROM ap.news_backlog WHERE id = $1', [backlogId])
    assert.equal(backlogAfter.rows[0].status, 'available')

    // The legacy path must now be able to (re-)adopt and claim it. Direct
    // UPDATE as the superuser connection simulates ap.adopt_news_backlog_item's
    // effect; that RPC's own contract is out of scope for this suite.
    await client.query(
      `UPDATE ap.news_backlog SET status='adopted', adopted_by_user_id=$2, adopted_at=now() WHERE id=$1`, [backlogId, staff])
    const assertAccess = await as(client, 'authenticated', staffClaims,
      `SELECT * FROM ap.assert_news_backlog_production_access($1, $2, 'https://example.com/c')`, [backlogId, cliente])
    assert.equal(assertAccess.rows[0].id, backlogId)
  })

  await t.test('legacy links a candidate first: R1 is refused (pre-existing behavior, must not regress)', async () => {
    const backlogId = id(30)
    const candidateId = id(31)
    await client.query(
      `INSERT INTO ap.news_backlog(id, cliente_id, status, titulo, url_original, adopted_by_user_id, adopted_at)
       VALUES ($1,$2,'adopted','Pauta B','https://example.com/b',$3,now())`,
      [backlogId, cliente, staff])
    await client.query(
      `INSERT INTO ap.candidate_news(id, cliente_id, status, titulo, url_original, criado_por_user_id)
       VALUES ($1,$2,'pending_render','Pauta B','https://example.com/b',$3)`,
      [candidateId, cliente, staff])
    await as(client, 'service_role', serviceClaims,
      `SELECT * FROM ap.link_news_backlog_candidate($1, $2, $3, $4, 'https://example.com/b')`,
      [backlogId, cliente, candidateId, staff])

    await assert.rejects(
      as(client, 'authenticated', staffClaims,
        `SELECT * FROM ap.start_editorial_article_from_backlog($1, $2)`, [backlogId, randomUUID()]),
      /BACKLOG_LEGACY_CANDIDATE_LINKED/
    )
  })
})
