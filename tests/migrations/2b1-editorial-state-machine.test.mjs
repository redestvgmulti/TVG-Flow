import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { createFixtureDatabase, dropFixtureDatabase, as, runtimeEnabled } from './2b1-fixture.mjs'

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

test('2B.1 pre-render state machine on ephemeral PostgreSQL', { skip: !runtimeEnabled }, async (t) => {
  const empresa = id(1), cliente = id(2), admin = id(3), staff = id(4)
  const adminClaims = { sub: admin, role: 'authenticated', app_role: 'admin' }
  const staffClaims = { sub: staff, role: 'authenticated' }
  const ctx = await createFixtureDatabase('tvg_2b1_state_machine')
  const { client } = ctx
  t.after(() => dropFixtureDatabase(ctx))

  await client.query(`INSERT INTO public.empresas(id) VALUES ($1)`, [empresa])
  await client.query(`INSERT INTO public.clientes(id, empresa_id) VALUES ($1, $2)`, [cliente, empresa])
  await client.query(`INSERT INTO public.profissionais(id, role, nome) VALUES ($1,'admin','Admin'), ($2,'staff','Staff')`, [admin, staff])
  await client.query(`INSERT INTO public.operational_clients(profissional_id, cliente_id) VALUES ($1,$2),($3,$4)`, [admin, cliente, staff, cliente])
  await as(client, 'authenticated', adminClaims, 'SELECT ap.set_editorial_workflow_v1_enabled(true)')

  let articleId

  await t.test('draft -> editing on first save', async () => {
    const created = await as(client, 'authenticated', staffClaims,
      `SELECT * FROM ap.start_editorial_article_direct('text', NULL, $1)`, [randomUUID()])
    articleId = created.rows[0].id
    assert.equal(created.rows[0].status, 'draft')

    const saved = await as(client, 'authenticated', staffClaims,
      `SELECT * FROM ap.save_editorial_article_draft($1, 'Headline v1', 'Body v1', $2)`, [articleId, randomUUID()])
    assert.equal(saved.rows[0].status, 'editing')
  })

  await t.test('optimistic concurrency: a stale expected_revision_number is rejected', async () => {
    await assert.rejects(
      as(client, 'authenticated', staffClaims,
        `SELECT * FROM ap.save_editorial_article_draft($1, 'Headline v2', 'Body v2', $2, 0)`, [articleId, randomUUID()]),
      /EDITORIAL_REVISION_CONFLICT/,
      'revision 1 already exists; expecting 0 must fail'
    )
    const saved = await as(client, 'authenticated', staffClaims,
      `SELECT * FROM ap.save_editorial_article_draft($1, 'Headline v2', 'Body v2', $2, 1)`, [articleId, randomUUID()])
    assert.equal(saved.rows[0].status, 'editing')
  })

  await t.test('editing -> content_final, format is required before approval', async () => {
    // Approval checks content_type on the row as it stands, regardless of
    // when production intent was set relative to finalize -- try the
    // rejection first, on an article with no format at all yet.
    const finalized = await as(client, 'authenticated', staffClaims,
      `SELECT * FROM ap.finalize_editorial_article($1, 'Headline final', 'Body final', $2, 2)`, [articleId, randomUUID()])
    assert.equal(finalized.rows[0].status, 'content_final')

    await assert.rejects(
      as(client, 'authenticated', adminClaims,
        `SELECT * FROM ap.approve_editorial_article_for_render($1, 3, $2)`, [articleId, randomUUID()]),
      /PRODUCTION_INTENT_REQUIRED/,
      'content_type was never set for this article'
    )

    // Setting production intent from content_final is refused (it is not in
    // draft/editing/changes_requested) -- the operator must go through the
    // review loop, exactly like any other post-finalize correction.
    await assert.rejects(
      as(client, 'authenticated', staffClaims,
        `SELECT * FROM ap.save_editorial_article_production_intent($1, 'text', 'feed', NULL, NULL, NULL, NULL, NULL, NULL, $2)`,
        [articleId, randomUUID()]),
      /ARTICLE_NOT_EDITABLE/
    )
  })

  await t.test('content_final -> changes_requested requires a reason and admin access', async () => {
    await assert.rejects(
      as(client, 'authenticated', staffClaims,
        `SELECT * FROM ap.request_editorial_article_changes($1, 'trying as staff', $2)`, [articleId, randomUUID()]),
      /EDITORIAL_ADMIN_REQUIRED/
    )
    await assert.rejects(
      as(client, 'authenticated', adminClaims,
        `SELECT * FROM ap.request_editorial_article_changes($1, '   ', $2)`, [articleId, randomUUID()]),
      /EDITORIAL_REASON_REQUIRED/
    )
    const back = await as(client, 'authenticated', adminClaims,
      `SELECT * FROM ap.request_editorial_article_changes($1, 'Ajustar legenda', $2)`, [articleId, randomUUID()])
    assert.equal(back.rows[0].status, 'changes_requested')
  })

  await t.test('changes_requested is editable again and can be re-finalized', async () => {
    const edited = await as(client, 'authenticated', staffClaims,
      `SELECT * FROM ap.save_editorial_article_draft($1, 'Headline final', 'Body corrigido', $2, 3)`, [articleId, randomUUID()])
    assert.equal(edited.rows[0].status, 'editing')

    // Production intent (format) is set here, while still editable -- this
    // is what unblocks approval in the next step.
    const withIntent = await as(client, 'authenticated', staffClaims,
      `SELECT * FROM ap.save_editorial_article_production_intent($1, 'text', 'feed', NULL, NULL, NULL, NULL, NULL, NULL, $2)`,
      [articleId, randomUUID()])
    assert.equal(withIntent.rows[0].content_type, 'feed')

    const finalized = await as(client, 'authenticated', staffClaims,
      `SELECT * FROM ap.finalize_editorial_article($1, 'Headline final', 'Body corrigido', $2, 4)`, [articleId, randomUUID()])
    assert.equal(finalized.rows[0].status, 'content_final')
  })

  await t.test('approval checks the exact revision being reviewed', async () => {
    await assert.rejects(
      as(client, 'authenticated', adminClaims,
        `SELECT * FROM ap.approve_editorial_article_for_render($1, 999, $2)`, [articleId, randomUUID()]),
      /EDITORIAL_REVISION_CONFLICT/
    )
    const approved = await as(client, 'authenticated', adminClaims,
      `SELECT * FROM ap.approve_editorial_article_for_render($1, 5, $2)`, [articleId, randomUUID()])
    assert.equal(approved.rows[0].status, 'ready_for_render')
    assert.equal(approved.rows[0].reviewed_by_user_id, admin)
  })

  await t.test('abandon is refused once content_final or later; only reachable from draft/editing/changes_requested', async () => {
    const created = await as(client, 'authenticated', staffClaims,
      `SELECT * FROM ap.start_editorial_article_direct('text', NULL, $1)`, [randomUUID()])
    const otherId = created.rows[0].id
    await as(client, 'authenticated', staffClaims,
      `SELECT * FROM ap.finalize_editorial_article($1, 'H', 'B', $2)`, [otherId, randomUUID()])
    await assert.rejects(
      as(client, 'authenticated', staffClaims,
        `SELECT * FROM ap.abandon_editorial_article($1, 'changed my mind', $2)`, [otherId, randomUUID()]),
      /CONTENT_ALREADY_FINAL/
    )
    await as(client, 'authenticated', adminClaims,
      `SELECT * FROM ap.request_editorial_article_changes($1, 'needs rework', $2)`, [otherId, randomUUID()])
    const abandoned = await as(client, 'authenticated', staffClaims,
      `SELECT * FROM ap.abandon_editorial_article($1, 'no longer needed', $2)`, [otherId, randomUUID()])
    assert.equal(abandoned.rows[0].status, 'abandoned')
  })
})
