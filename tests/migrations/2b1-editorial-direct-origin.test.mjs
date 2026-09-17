import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { createFixtureDatabase, dropFixtureDatabase, as, runtimeEnabled } from './2b1-fixture.mjs'

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

test('2B.1 direct origin (Link/Text/Image) on ephemeral PostgreSQL', { skip: !runtimeEnabled }, async (t) => {
  const empresa = id(1), cliente = id(2), staff = id(4)
  const staffClaims = { sub: staff, role: 'authenticated' }
  const ctx = await createFixtureDatabase('tvg_2b1_direct_origin')
  const { client } = ctx
  t.after(() => dropFixtureDatabase(ctx))

  await client.query(`INSERT INTO public.empresas(id) VALUES ($1)`, [empresa])
  await client.query(`INSERT INTO public.clientes(id, empresa_id) VALUES ($1, $2)`, [cliente, empresa])
  await client.query(`INSERT INTO public.profissionais(id, role, nome) VALUES ($1,'staff','Staff')`, [staff])
  await client.query(`INSERT INTO public.operational_clients(profissional_id, cliente_id) VALUES ($1,$2)`, [staff, cliente])
  await client.query(`INSERT INTO public.profissionais(id, role, nome) VALUES ($1,'admin','Admin')`, [id(3)])
  await client.query(`INSERT INTO public.operational_clients(profissional_id, cliente_id) VALUES ($1,$2)`, [id(3), cliente])
  await as(client, 'authenticated', { sub: id(3), role: 'authenticated', app_role: 'admin' },
    'SELECT ap.set_editorial_workflow_v1_enabled(true)')

  await t.test('link origin requires an http(s) reference', async () => {
    const article = await as(client, 'authenticated', staffClaims,
      `SELECT * FROM ap.start_editorial_article_direct('link', 'https://example.com/n', $1)`, [randomUUID()])
    assert.equal(article.rows[0].origin_type, 'link')
    assert.equal(article.rows[0].origin_reference, 'https://example.com/n')
    assert.equal(article.rows[0].production_input_type, 'link')
    assert.equal(article.rows[0].news_backlog_id, null)

    await assert.rejects(
      as(client, 'authenticated', staffClaims,
        `SELECT * FROM ap.start_editorial_article_direct('link', 'not-a-url', $1)`, [randomUUID()]),
      /ORIGIN_REFERENCE_URL_REQUIRED/
    )
    await assert.rejects(
      as(client, 'authenticated', staffClaims,
        `SELECT * FROM ap.start_editorial_article_direct('link', NULL, $1)`, [randomUUID()]),
      /ORIGIN_REFERENCE_URL_REQUIRED/
    )
  })

  await t.test('image origin requires an http(s) reference, same as link', async () => {
    await assert.rejects(
      as(client, 'authenticated', staffClaims,
        `SELECT * FROM ap.start_editorial_article_direct('image', '', $1)`, [randomUUID()]),
      /ORIGIN_REFERENCE_URL_REQUIRED/
    )
    const article = await as(client, 'authenticated', staffClaims,
      `SELECT * FROM ap.start_editorial_article_direct('image', 'https://example.com/photo.jpg', $1)`, [randomUUID()])
    assert.equal(article.rows[0].origin_type, 'image')
  })

  await t.test('text origin must not carry a reference', async () => {
    await assert.rejects(
      as(client, 'authenticated', staffClaims,
        `SELECT * FROM ap.start_editorial_article_direct('text', 'https://example.com', $1)`, [randomUUID()]),
      /ORIGIN_REFERENCE_NOT_ALLOWED/
    )
    const article = await as(client, 'authenticated', staffClaims,
      `SELECT * FROM ap.start_editorial_article_direct('text', NULL, $1)`, [randomUUID()])
    assert.equal(article.rows[0].origin_type, 'text')
    assert.equal(article.rows[0].origin_reference, null)
  })

  await t.test('an invalid origin_type is rejected outright', async () => {
    await assert.rejects(
      as(client, 'authenticated', staffClaims,
        `SELECT * FROM ap.start_editorial_article_direct('radar', NULL, $1)`, [randomUUID()]),
      /ORIGIN_TYPE_INVALID/
    )
  })

  await t.test('origin_type/origin_reference never change even when production_input_type does', async () => {
    const created = await as(client, 'authenticated', staffClaims,
      `SELECT * FROM ap.start_editorial_article_direct('link', 'https://example.com/switch', $1)`, [randomUUID()])
    const articleId = created.rows[0].id

    const updated = await as(client, 'authenticated', staffClaims,
      `SELECT * FROM ap.save_editorial_article_production_intent($1, 'text', 'feed', NULL, NULL, NULL, NULL, NULL, NULL, $2)`,
      [articleId, randomUUID()])
    assert.equal(updated.rows[0].production_input_type, 'text')
    assert.equal(updated.rows[0].origin_type, 'link', 'origin_type must survive a production method change')
    assert.equal(updated.rows[0].origin_reference, 'https://example.com/switch')
  })

  await t.test('the same request_id resolves to the same article instead of creating a duplicate', async () => {
    const requestId = randomUUID()
    const first = await as(client, 'authenticated', staffClaims,
      `SELECT * FROM ap.start_editorial_article_direct('text', NULL, $1)`, [requestId])
    const second = await as(client, 'authenticated', staffClaims,
      `SELECT * FROM ap.start_editorial_article_direct('text', NULL, $1)`, [requestId])
    assert.equal(second.rows[0].id, first.rows[0].id)
  })
})
