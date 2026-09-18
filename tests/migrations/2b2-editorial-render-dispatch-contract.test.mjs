import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import pg from 'pg'
import { createFixtureDatabase, dropFixtureDatabase, as, connection, runtimeEnabled } from './2b1-fixture.mjs'

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

// ap-editorial-render-dispatch/index.ts is Deno/TS orchestration, not
// runnable under `node --test`. What has to actually be correct is the
// database contract it depends on -- this file proves that contract,
// with the same rigor as 2b1-editorial-p0-bridge.test.mjs.
//
// The real ap.create_candidate_with_sponsors (the RPC the dispatch function
// calls on the legacy trail) is NOT loaded into this synthetic fixture: its
// current definition (supabase/migrations/20260723235947_make_sponsor_retries_snapshot_driven.sql)
// is one link in a long chain of prior sponsor-rotation/visual-catalog
// migrations this fixture deliberately does not replay (same reasoning as
// tests/p0/fixture.sql: an isolated contract fixture, not a replay of
// unrelated legacy history). Its concurrency-safety was verified by direct
// inspection instead: lines 110-115 take
// `pg_advisory_xact_lock(hashtextextended(cliente_id || ':' || idempotency_key, 0))`
// before the existing-row read, so two transactions with the same
// (cliente_id, idempotency_key) serialize rather than race; and
// `ap.candidate_news` additionally carries a partial UNIQUE index on
// (cliente_id, idempotency_key) (20260723181519_autopublisher_sponsor_rotation_v1.sql:106-108)
// as a hard backstop even without the lock. The first test below proves that
// exact pattern (advisory lock + unique index) is genuinely race-safe, using
// a stand-in function with the identical shape, since re-loading the real
// one here would mean replaying schema this suite has no other reason to
// depend on.
test('2B.2.1 render-dispatch database contract on ephemeral PostgreSQL', { skip: !runtimeEnabled }, async (t) => {
  const empresa = id(1), cliente = id(2), admin = id(3), staff = id(4)
  const adminClaims = { sub: admin, role: 'authenticated', app_role: 'admin' }
  const staffClaims = { sub: staff, role: 'authenticated' }
  const serviceClaims = { role: 'service_role' }
  const ctx = await createFixtureDatabase('tvg_2b2_dispatch_contract')
  const { client } = ctx
  t.after(() => dropFixtureDatabase(ctx))

  await client.query(`INSERT INTO public.empresas(id) VALUES ($1)`, [empresa])
  await client.query(`INSERT INTO public.clientes(id, empresa_id) VALUES ($1, $2)`, [cliente, empresa])
  await client.query(`INSERT INTO public.profissionais(id, role, nome) VALUES ($1,'admin','Admin'), ($2,'staff','Staff')`, [admin, staff])
  await client.query(`INSERT INTO public.operational_clients(profissional_id, cliente_id) VALUES ($1,$2),($3,$4)`, [admin, cliente, staff, cliente])
  await as(client, 'authenticated', adminClaims, 'SELECT ap.set_editorial_workflow_v1_enabled(true)')

  await client.query(`ALTER TABLE ap.candidate_news ADD COLUMN IF NOT EXISTS idempotency_key uuid`)
  await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS ux_candidate_idempotency
    ON ap.candidate_news (cliente_id, idempotency_key) WHERE idempotency_key IS NOT NULL`)
  // Same shape as the real create_candidate_with_sponsors: advisory lock on
  // (cliente_id, idempotency_key), then find-or-insert under that lock.
  await client.query(`
    CREATE FUNCTION ap.test_create_candidate_idempotent(p_cliente_id uuid, p_idempotency_key uuid, p_titulo text, p_criado_por uuid)
    RETURNS uuid LANGUAGE plpgsql AS $$
    DECLARE v_id uuid;
    BEGIN
      PERFORM pg_advisory_xact_lock(hashtextextended(p_cliente_id::text || ':' || p_idempotency_key::text, 0));
      SELECT id INTO v_id FROM ap.candidate_news WHERE cliente_id = p_cliente_id AND idempotency_key = p_idempotency_key FOR UPDATE;
      IF FOUND THEN RETURN v_id; END IF;
      PERFORM pg_sleep(0.05); -- widen the window a losing transaction could race into without the lock
      INSERT INTO ap.candidate_news(id, cliente_id, status, titulo, idempotency_key, criado_por_user_id)
      VALUES (gen_random_uuid(), p_cliente_id, 'processing', p_titulo, p_idempotency_key, p_criado_por)
      RETURNING id INTO v_id;
      RETURN v_id;
    END; $$;
  `)

  await t.test('advisory-lock + unique-index pattern: two concurrent calls, same idempotency key, exactly one row', async () => {
    const idempotencyKey = randomUUID()
    const connA = new pg.Client({ ...connection, database: ctx.databaseName })
    const connB = new pg.Client({ ...connection, database: ctx.databaseName })
    await connA.connect()
    await connB.connect()
    try {
      const callOnce = (conn) => conn.query(
        `SELECT ap.test_create_candidate_idempotent($1,$2,'Titulo Concorrente',$3) AS candidate_id`,
        [cliente, idempotencyKey, staff],
      )
      const [resultA, resultB] = await Promise.all([callOnce(connA), callOnce(connB)])
      assert.equal(resultA.rows[0].candidate_id, resultB.rows[0].candidate_id,
        'both concurrent calls must resolve to the same candidate')

      const count = await client.query(
        `SELECT count(*)::int AS n FROM ap.candidate_news WHERE cliente_id=$1 AND idempotency_key=$2`,
        [cliente, idempotencyKey],
      )
      assert.equal(count.rows[0].n, 1, 'exactly one candidate_news row must exist for this idempotency key')
    } finally {
      await connA.end()
      await connB.end()
    }
  })

  await t.test('full dispatch cycle: ready_for_render article -> candidate -> attach, retried is a no-op', async () => {
    const created = await as(client, 'authenticated', staffClaims,
      `SELECT * FROM ap.start_editorial_article_direct('text', NULL, $1)`, [randomUUID()])
    const articleId = created.rows[0].id
    await as(client, 'authenticated', staffClaims,
      `SELECT * FROM ap.save_editorial_article_production_intent($1,'text','feed',NULL,NULL,NULL,NULL,NULL,NULL,$2)`,
      [articleId, randomUUID()])
    await as(client, 'authenticated', staffClaims,
      `SELECT * FROM ap.finalize_editorial_article($1, 'Despacho real', 'Corpo do despacho', $2)`, [articleId, randomUUID()])
    await as(client, 'authenticated', adminClaims,
      `SELECT * FROM ap.approve_editorial_article_for_render($1, 1, $2)`, [articleId, randomUUID()])

    // Mirrors what ap-editorial-render-dispatch/index.ts does: claim (article_id
    // is the idempotency key of the candidate it creates) -> create -> attach.
    const claim = await as(client, 'service_role', serviceClaims,
      `SELECT * FROM ap.claim_editorial_article_for_render($1)`, [articleId])
    assert.equal(claim.rows[0].headline, 'Despacho real')

    const created1 = await as(client, 'service_role', serviceClaims,
      `SELECT ap.test_create_candidate_idempotent($1,$2,$3,$4) AS candidate_id`,
      [cliente, articleId, claim.rows[0].headline, claim.rows[0].author_user_id])
    const candidateId = created1.rows[0].candidate_id
    await client.query(`UPDATE ap.candidate_news SET status='pending_render' WHERE id=$1`, [candidateId])

    await as(client, 'service_role', serviceClaims,
      `SELECT * FROM ap.attach_editorial_article_candidate($1, $2)`, [articleId, candidateId])

    const claimAgain = await as(client, 'service_role', serviceClaims,
      `SELECT * FROM ap.claim_editorial_article_for_render($1)`, [articleId])
    assert.equal(claimAgain.rows[0].candidate_news_id, candidateId)

    const created2 = await as(client, 'service_role', serviceClaims,
      `SELECT ap.test_create_candidate_idempotent($1,$2,$3,$4) AS candidate_id`,
      [cliente, articleId, claim.rows[0].headline, claim.rows[0].author_user_id])
    assert.equal(created2.rows[0].candidate_id, candidateId, 'retry reuses the same candidate by idempotency key')

    const attachAgain = await as(client, 'service_role', serviceClaims,
      `SELECT * FROM ap.attach_editorial_article_candidate($1, $2)`, [articleId, candidateId])
    assert.equal(attachAgain.rows[0].candidate_news_id, candidateId, 'attach retry is a no-op, not an error')

    const finalCount = await client.query(
      `SELECT count(*)::int AS n FROM ap.candidate_news WHERE cliente_id=$1 AND idempotency_key=$2`,
      [cliente, articleId],
    )
    assert.equal(finalCount.rows[0].n, 1)
  })

  await t.test('partial failure recovery: candidate created but attach never ran, retry completes it without duplicating', async () => {
    const created = await as(client, 'authenticated', staffClaims,
      `SELECT * FROM ap.start_editorial_article_direct('text', NULL, $1)`, [randomUUID()])
    const articleId = created.rows[0].id
    await as(client, 'authenticated', staffClaims,
      `SELECT * FROM ap.save_editorial_article_production_intent($1,'text','feed',NULL,NULL,NULL,NULL,NULL,NULL,$2)`,
      [articleId, randomUUID()])
    await as(client, 'authenticated', staffClaims,
      `SELECT * FROM ap.finalize_editorial_article($1, 'Falha parcial', 'Corpo', $2)`, [articleId, randomUUID()])
    await as(client, 'authenticated', adminClaims,
      `SELECT * FROM ap.approve_editorial_article_for_render($1, 1, $2)`, [articleId, randomUUID()])

    const claim = await as(client, 'service_role', serviceClaims,
      `SELECT * FROM ap.claim_editorial_article_for_render($1)`, [articleId])

    // Simulates the dispatch crashing right after candidate creation, before attach.
    const created1 = await as(client, 'service_role', serviceClaims,
      `SELECT ap.test_create_candidate_idempotent($1,$2,$3,$4) AS candidate_id`,
      [cliente, articleId, claim.rows[0].headline, claim.rows[0].author_user_id])
    const candidateId = created1.rows[0].candidate_id
    await client.query(`UPDATE ap.candidate_news SET status='pending_render' WHERE id=$1`, [candidateId])

    const claimRetry = await as(client, 'service_role', serviceClaims,
      `SELECT * FROM ap.claim_editorial_article_for_render($1)`, [articleId])
    assert.equal(claimRetry.rows[0].candidate_news_id, null)
    assert.equal(claimRetry.rows[0].status, 'ready_for_render')

    const created2 = await as(client, 'service_role', serviceClaims,
      `SELECT ap.test_create_candidate_idempotent($1,$2,$3,$4) AS candidate_id`,
      [cliente, articleId, claim.rows[0].headline, claim.rows[0].author_user_id])
    assert.equal(created2.rows[0].candidate_id, candidateId)

    const attached = await as(client, 'service_role', serviceClaims,
      `SELECT * FROM ap.attach_editorial_article_candidate($1, $2)`, [articleId, candidateId])
    assert.equal(attached.rows[0].status, 'dispatched')
  })
})
