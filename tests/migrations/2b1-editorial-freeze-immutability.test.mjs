import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { createFixtureDatabase, dropFixtureDatabase, as, runtimeEnabled } from './2b1-fixture.mjs'

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

test('2B.1 freeze immutability on ephemeral PostgreSQL', { skip: !runtimeEnabled }, async (t) => {
  const empresa = id(1), cliente = id(2), admin = id(3), staff = id(4)
  const adminClaims = { sub: admin, role: 'authenticated', app_role: 'admin' }
  const staffClaims = { sub: staff, role: 'authenticated' }
  const ctx = await createFixtureDatabase('tvg_2b1_freeze')
  const { client } = ctx
  t.after(() => dropFixtureDatabase(ctx))

  await client.query(`INSERT INTO public.empresas(id) VALUES ($1)`, [empresa])
  await client.query(`INSERT INTO public.clientes(id, empresa_id) VALUES ($1, $2)`, [cliente, empresa])
  await client.query(`INSERT INTO public.profissionais(id, role, nome) VALUES ($1,'admin','Admin'), ($2,'staff','Staff')`, [admin, staff])
  await client.query(`INSERT INTO public.operational_clients(profissional_id, cliente_id) VALUES ($1,$2),($3,$4)`, [admin, cliente, staff, cliente])
  await as(client, 'authenticated', adminClaims, 'SELECT ap.set_editorial_workflow_v1_enabled(true)')

  const created = await as(client, 'authenticated', staffClaims,
    `SELECT * FROM ap.start_editorial_article_direct('text', NULL, $1)`, [randomUUID()])
  const articleId = created.rows[0].id
  await as(client, 'authenticated', staffClaims,
    `SELECT * FROM ap.save_editorial_article_production_intent($1,'text','feed',NULL,NULL,NULL,NULL,NULL,NULL,$2)`,
    [articleId, randomUUID()])
  await as(client, 'authenticated', staffClaims,
    `SELECT * FROM ap.finalize_editorial_article($1, 'Headline', 'Body', $2)`, [articleId, randomUUID()])
  await as(client, 'authenticated', adminClaims,
    `SELECT * FROM ap.approve_editorial_article_for_render($1, 1, $2)`, [articleId, randomUUID()])

  await t.test('every editable RPC refuses a ready_for_render article', async () => {
    await assert.rejects(
      as(client, 'authenticated', staffClaims,
        `SELECT * FROM ap.save_editorial_article_draft($1, 'x', 'y', $2)`, [articleId, randomUUID()]),
      /ARTICLE_NOT_EDITABLE/
    )
    await assert.rejects(
      as(client, 'authenticated', staffClaims,
        `SELECT * FROM ap.finalize_editorial_article($1, 'x', 'y', $2)`, [articleId, randomUUID()]),
      /ARTICLE_NOT_EDITABLE/
    )
    await assert.rejects(
      as(client, 'authenticated', staffClaims,
        `SELECT * FROM ap.save_editorial_article_production_intent($1,'link','reels',NULL,NULL,NULL,NULL,NULL,NULL,$2)`,
        [articleId, randomUUID()]),
      /ARTICLE_NOT_EDITABLE/
    )
  })

  await t.test('a direct UPDATE bypassing every RPC is still blocked by the freeze trigger', async () => {
    // No API role (anon/authenticated/service_role) has any table grant on
    // editorial_articles -- every real write goes through a SECURITY
    // DEFINER RPC owned by the migration-applying superuser, which bypasses
    // table grants via ownership. This proves the trigger, not just the
    // RPCs, is what actually enforces the freeze (matching the P0 pattern).
    await assert.rejects(
      client.query(`UPDATE ap.editorial_articles SET content_type = 'reels' WHERE id = $1`, [articleId]),
      /EDITORIAL_ARTICLE_FROZEN/
    )
    await assert.rejects(
      client.query(`UPDATE ap.editorial_articles SET status = 'draft' WHERE id = $1`, [articleId]),
      /EDITORIAL_ARTICLE_FROZEN/
    )
    await assert.rejects(
      client.query(`UPDATE ap.editorial_articles SET responsible_user_id = $2 WHERE id = $1`, [articleId, id(99)]),
      /EDITORIAL_ARTICLE_FROZEN/
    )
  })

  await t.test('the only transition the trigger allows post-freeze is ready_for_render -> dispatched with a candidate', async () => {
    await client.query(
      `INSERT INTO ap.candidate_news(id, cliente_id, status, titulo, criado_por_user_id) VALUES ($1,$2,'pending_render','Headline',$3)`,
      [id(50), cliente, staff])
    const attached = await as(client, 'service_role', { role: 'service_role' },
      `SELECT * FROM ap.attach_editorial_article_candidate($1, $2)`, [articleId, id(50)])
    assert.equal(attached.rows[0].status, 'dispatched')

    // Once dispatched, even that same transition cannot repeat with a different candidate.
    await client.query(
      `INSERT INTO ap.candidate_news(id, cliente_id, status, titulo, criado_por_user_id) VALUES ($1,$2,'pending_render','Other',$3)`,
      [id(51), cliente, staff])
    await assert.rejects(
      as(client, 'service_role', { role: 'service_role' },
        `SELECT * FROM ap.attach_editorial_article_candidate($1, $2)`, [articleId, id(51)]),
      /CANDIDATE_MISMATCH/
    )
  })
})
