import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { createFixtureDatabase, dropFixtureDatabase, as, runtimeEnabled } from './2b1-fixture.mjs'

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

// The most important test in this suite: proves the 2B.1 handoff does not
// violate any P0 invariant when both migration chains are applied together
// against the real shape of ap.candidate_news (from tests/p0/fixture.sql).
test('2B.1 editorial article -> P0 render pipeline handoff on ephemeral PostgreSQL', { skip: !runtimeEnabled }, async (t) => {
  const empresa = id(1), cliente = id(2), admin = id(3), staff = id(4)
  const adminClaims = { sub: admin, role: 'authenticated', app_role: 'admin' }
  const staffClaims = { sub: staff, role: 'authenticated' }
  const serviceClaims = { role: 'service_role' }
  const ctx = await createFixtureDatabase('tvg_2b1_p0_bridge')
  const { client } = ctx
  t.after(() => dropFixtureDatabase(ctx))

  await client.query(`INSERT INTO public.empresas(id) VALUES ($1)`, [empresa])
  await client.query(`INSERT INTO public.clientes(id, empresa_id) VALUES ($1, $2)`, [cliente, empresa])
  await client.query(`INSERT INTO public.profissionais(id, role, nome) VALUES ($1,'admin','Admin'), ($2,'staff','Staff')`, [admin, staff])
  await client.query(`INSERT INTO public.operational_clients(profissional_id, cliente_id) VALUES ($1,$2),($3,$4)`, [admin, cliente, staff, cliente])
  await as(client, 'authenticated', adminClaims, 'SELECT ap.set_editorial_workflow_v1_enabled(true)')

  const backlogId = id(10)
  await client.query(
    `INSERT INTO ap.news_backlog(id, cliente_id, status, titulo, url_original, adopted_by_user_id, adopted_at)
     VALUES ($1,$2,'adopted','Pauta Ponte','https://example.com/bridge',$3,now())`,
    [backlogId, cliente, staff])

  let articleId, generationId, candidateId

  await t.test('editorial article reaches ready_for_render from an adopted backlog item', async () => {
    const started = await as(client, 'authenticated', staffClaims,
      `SELECT * FROM ap.start_editorial_article_from_backlog($1, $2)`, [backlogId, randomUUID()])
    articleId = started.rows[0].id
    await as(client, 'authenticated', staffClaims,
      `SELECT * FROM ap.save_editorial_article_production_intent($1,'text','feed',NULL,NULL,NULL,NULL,NULL,NULL,$2)`,
      [articleId, randomUUID()])
    await as(client, 'authenticated', staffClaims,
      `SELECT * FROM ap.finalize_editorial_article($1, 'Ponte P0', 'Conteudo da ponte', $2)`, [articleId, randomUUID()])
    const approved = await as(client, 'authenticated', adminClaims,
      `SELECT * FROM ap.approve_editorial_article_for_render($1, 1, $2)`, [articleId, randomUUID()])
    assert.equal(approved.rows[0].status, 'ready_for_render')
  })

  await t.test('a dispatch worker claims the article, creates the candidate, and attaches it', async () => {
    const claim = await as(client, 'service_role', serviceClaims,
      `SELECT * FROM ap.claim_editorial_article_for_render($1)`, [articleId])
    assert.equal(claim.rows[0].headline, 'Ponte P0')
    assert.equal(claim.rows[0].body, 'Conteudo da ponte')
    assert.equal(claim.rows[0].content_type, 'feed')

    candidateId = randomUUID()
    // Simulates what the 2B.2 dispatch Edge Function will do: create the
    // candidate through the existing legacy creation path (not replicated
    // here), then hand its id back to the editorial domain.
    await client.query('SET ROLE service_role')
    await client.query(
      `INSERT INTO ap.candidate_news(id, cliente_id, status, content_type, titulo, headline, conteudo, caption, url_original, criado_por_user_id)
       VALUES ($1,$2,'pending_render','feed',$3,$3,$4,$4,'https://example.com/bridge',$5)`,
      [candidateId, cliente, claim.rows[0].headline, claim.rows[0].body, staff])
    await client.query('RESET ROLE')

    const attached = await as(client, 'service_role', serviceClaims,
      `SELECT * FROM ap.attach_editorial_article_candidate($1, $2)`, [articleId, candidateId])
    assert.equal(attached.rows[0].status, 'dispatched')
    assert.equal(attached.rows[0].candidate_news_id, candidateId)

    // Idempotent: a retried dispatch (same candidate) must not error.
    const attachedAgain = await as(client, 'service_role', serviceClaims,
      `SELECT * FROM ap.attach_editorial_article_candidate($1, $2)`, [articleId, candidateId])
    assert.equal(attachedAgain.rows[0].candidate_news_id, candidateId)
  })

  await t.test('attach refuses a candidate from a different tenant or an already-used one', async () => {
    const otherEmpresa = id(90), otherCliente = id(91)
    await client.query(`INSERT INTO public.empresas(id) VALUES ($1)`, [otherEmpresa])
    await client.query(`INSERT INTO public.clientes(id, empresa_id) VALUES ($1, $2)`, [otherCliente, otherEmpresa])
    const foreignCandidate = randomUUID()
    await client.query(
      `INSERT INTO ap.candidate_news(id, cliente_id, status, titulo) VALUES ($1,$2,'pending_render','Foreign')`,
      [foreignCandidate, otherCliente])

    const started = await as(client, 'authenticated', staffClaims,
      `SELECT * FROM ap.start_editorial_article_direct('text', NULL, $1)`, [randomUUID()])
    const secondArticleId = started.rows[0].id
    await as(client, 'authenticated', staffClaims,
      `SELECT * FROM ap.save_editorial_article_production_intent($1,'text','feed',NULL,NULL,NULL,NULL,NULL,NULL,$2)`,
      [secondArticleId, randomUUID()])
    await as(client, 'authenticated', staffClaims,
      `SELECT * FROM ap.finalize_editorial_article($1, 'H', 'B', $2)`, [secondArticleId, randomUUID()])
    await as(client, 'authenticated', adminClaims,
      `SELECT * FROM ap.approve_editorial_article_for_render($1, 1, $2)`, [secondArticleId, randomUUID()])

    await assert.rejects(
      as(client, 'service_role', serviceClaims,
        `SELECT * FROM ap.attach_editorial_article_candidate($1, $2)`, [secondArticleId, foreignCandidate]),
      /CANDIDATE_TENANT_MISMATCH/
    )
    await assert.rejects(
      as(client, 'service_role', serviceClaims,
        `SELECT * FROM ap.attach_editorial_article_candidate($1, $2)`, [secondArticleId, candidateId]),
      /CANDIDATE_ALREADY_ATTACHED/,
      'candidateId is already claimed by the first article'
    )

    // 'approved'/'posted'/'changes_requested' are refused by P0's own INSERT
    // guard (ap_private.guard_candidate_p0) as forged evidence, so a
    // not-fresh-but-insertable status is used here: pending_review is well
    // past processing/pending_render but a legitimate INSERT value.
    const staleCandidate = randomUUID()
    await client.query(
      `INSERT INTO ap.candidate_news(id, cliente_id, status, titulo) VALUES ($1,$2,'pending_review','Stale')`,
      [staleCandidate, cliente])
    await assert.rejects(
      as(client, 'service_role', serviceClaims,
        `SELECT * FROM ap.attach_editorial_article_candidate($1, $2)`, [secondArticleId, staleCandidate]),
      /CANDIDATE_NOT_FRESH/,
      'a candidate already past processing/pending_render must not be claimable'
    )
  })

  await t.test('the P0 render pipeline runs end to end on the attached candidate without any invariant violation', async () => {
    const begin = await as(client, 'service_role', serviceClaims, `SELECT * FROM ap.p0_begin_render($1)`, [candidateId])
    generationId = begin.rows[0].p0_begin_render.generation_id
    assert.ok(generationId)

    await as(client, 'service_role', serviceClaims,
      `SELECT ap.p0_record_render_plan($1, $2::jsonb)`,
      [generationId, JSON.stringify({ templateId: 'tpl', layers: { headline: { text: 'Ponte P0' } } })])

    const path = `${cliente}/${candidateId}/${generationId}.png`
    await as(client, 'service_role', serviceClaims, `SELECT ap.p0_reserve_render_asset($1, $2)`, [generationId, path])

    const url = `https://project.example/storage/v1/object/public/ap-renders/${path}`
    await as(client, 'service_role', serviceClaims, `SELECT ap.p0_complete_render($1, $2, $3)`, [generationId, path, url])

    const candidate = await client.query(
      'SELECT status, current_generation_id, render_url FROM ap.candidate_news WHERE id=$1', [candidateId])
    assert.equal(candidate.rows[0].status, 'pending_review', 'P0 never auto-approves')
    assert.equal(candidate.rows[0].current_generation_id, generationId)
    assert.equal(candidate.rows[0].render_url, url)

    await as(client, 'authenticated', adminClaims,
      `SELECT ap.p0_approve_generation($1, $2, $3, $4)`, [candidateId, cliente, generationId, url])

    const approved = await client.query(
      'SELECT status, approved_generation_id FROM ap.candidate_news WHERE id=$1', [candidateId])
    assert.equal(approved.rows[0].status, 'approved')
    assert.equal(approved.rows[0].approved_generation_id, generationId)

    // The editorial article's own record of the handoff is untouched by
    // anything P0 did -- attach was the last write this domain makes.
    const article = await client.query('SELECT status, candidate_news_id FROM ap.editorial_articles WHERE id=$1', [articleId])
    assert.equal(article.rows[0].status, 'dispatched')
    assert.equal(article.rows[0].candidate_news_id, candidateId)
  })
})
