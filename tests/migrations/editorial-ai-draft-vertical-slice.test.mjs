import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { createFixtureDatabase, dropFixtureDatabase, as, connection, runtimeEnabled } from './2b1-fixture.mjs'

const migrationUrl = new URL('../../supabase/migrations/20260920002600_editorial_ai_draft_vertical_slice.sql', import.meta.url)
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const draft = {
  headline: 'Prefeitura conclui etapa administrativa de teste',
  body: 'A Prefeitura informou nesta sexta-feira que concluiu uma etapa administrativa criada exclusivamente para uma validação técnica.',
  caption: 'Etapa administrativa de teste foi concluída nesta sexta-feira.',
  context_tag: 'administração pública',
  category: 'Cidades',
  location: { city: null, region: null, state: null },
}

test('migration is fail-closed, append-only, tenant-derived and never touches production tables', async () => {
  const sql = await readFile(migrationUrl, 'utf8')
  assert.match(sql, /editorial_ai_draft_enabled boolean NOT NULL DEFAULT false/)
  assert.match(sql, /editorial_article_sources_append_only/)
  assert.match(sql, /FOR EACH ROW EXECUTE FUNCTION ap\.reject_editorial_append_only_mutation/)
  assert.match(sql, /public\.require_single_operational_cliente_id\(\)/)
  assert.match(sql, /EDITORIAL_AI_REVISION_CONFLICT/)
  assert.match(sql, /UNIQUE \(article_id, request_id\)/)
  assert.match(sql, /WHERE status = 'processing'/)
  assert.match(sql, /ai_processing_started/)
  assert.match(sql, /ai_draft_generated/)
  assert.doesNotMatch(sql, /INSERT INTO ap\.candidate_news|UPDATE ap\.candidate_news/)
  assert.doesNotMatch(sql, /render_generations|instagram|placid/i)
  assert.match(sql, /GRANT EXECUTE ON FUNCTION ap\.complete_editorial_ai_draft[\s\S]+ TO service_role/)
  assert.doesNotMatch(sql, /GRANT EXECUTE ON FUNCTION ap\.complete_editorial_ai_draft[^;]+ TO authenticated/)
})

test('AI draft SQL contract on ephemeral PostgreSQL', { skip: !runtimeEnabled }, async (t) => {
  const empresaA = id(101), clienteA = id(102), adminA = id(103), staffA = id(104), outsiderA = id(105)
  const empresaB = id(201), clienteB = id(202), staffB = id(204)
  const claimsA = { sub: staffA, role: 'authenticated' }
  const ctx = await createFixtureDatabase('tvg_editorial_ai')
  const { client } = ctx
  t.after(() => dropFixtureDatabase(ctx))

  await client.query(`
    CREATE TABLE IF NOT EXISTS ap.editorial_logs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), cliente_id uuid NOT NULL,
      input_tokens integer, output_tokens integer, model text, prompt_snapshot text
    );
  `)
  await client.query(await readFile(migrationUrl, 'utf8'))

  await client.query('INSERT INTO public.empresas(id) VALUES ($1),($2)', [empresaA, empresaB])
  await client.query('INSERT INTO public.clientes(id, empresa_id) VALUES ($1,$2),($3,$4)', [clienteA, empresaA, clienteB, empresaB])
  await client.query("INSERT INTO public.profissionais(id, role, nome) VALUES ($1,'admin','Admin A'),($2,'staff','Staff A'),($3,'staff','Staff B'),($4,'staff','Other A')", [adminA, staffA, staffB, outsiderA])
  await client.query('INSERT INTO public.operational_clients(profissional_id, cliente_id) VALUES ($1,$2),($3,$2),($4,$5),($6,$2)', [adminA, clienteA, staffA, staffB, clienteB, outsiderA])
  await as(client, 'authenticated', { sub: adminA, role: 'authenticated', app_role: 'admin' }, 'SELECT ap.set_editorial_workflow_v1_enabled(true)')
  await as(client, 'authenticated', { sub: adminA, role: 'authenticated', app_role: 'admin' }, 'SELECT ap.set_editorial_ai_draft_enabled(true)')

  const createArticle = async () => {
    const result = await as(client, 'authenticated', claimsA,
      `SELECT * FROM ap.start_editorial_article_direct('text', NULL, $1)`, [randomUUID()])
    return result.rows[0].id
  }

  await t.test('source remains immutable and successful retries create one AI revision', async () => {
    const articleId = await createArticle()
    const sourceRequest = randomUUID()
    const source = 'A Prefeitura informou nesta sexta-feira a conclusão de uma etapa administrativa de teste.'
    await as(client, 'authenticated', claimsA,
      "SELECT * FROM ap.capture_editorial_article_source($1,'text',NULL,'Fonte',$2,NULL,$3)",
      [articleId, source, sourceRequest])
    const same = await as(client, 'authenticated', claimsA,
      "SELECT * FROM ap.capture_editorial_article_source($1,'text',NULL,'Fonte',$2,NULL,$3)",
      [articleId, source, sourceRequest])
    assert.equal(same.rows[0].source_body, source)
    await assert.rejects(
      as(client, 'authenticated', claimsA,
        "SELECT * FROM ap.capture_editorial_article_source($1,'text',NULL,'Fonte','changed',NULL,$2)",
        [articleId, randomUUID()]), /EDITORIAL_SOURCE_ALREADY_CAPTURED/)

    const requestId = randomUUID()
    const claim = await as(client, 'authenticated', claimsA,
      'SELECT * FROM ap.claim_editorial_ai_draft($1,$2)', [articleId, requestId])
    const completed = await as(client, 'service_role', { role: 'service_role' },
      "SELECT * FROM ap.complete_editorial_ai_draft($1,$2::jsonb,'anthropic','test-model',100,50,900)",
      [claim.rows[0].run_id, JSON.stringify(draft)])
    assert.equal(completed.rows[0].applied, true)

    const retry = await as(client, 'authenticated', claimsA,
      'SELECT * FROM ap.claim_editorial_ai_draft($1,$2)', [articleId, requestId])
    assert.equal(retry.rows[0].reused, true)
    const counts = await client.query(`
      SELECT
        (SELECT count(*) FROM ap.editorial_article_sources WHERE article_id=$1)::int sources,
        (SELECT count(*) FROM ap.editorial_article_revisions WHERE article_id=$1 AND revision_kind='ai_draft')::int revisions,
        (SELECT count(*) FROM ap.editorial_ai_draft_runs WHERE article_id=$1)::int runs
    `, [articleId])
    assert.deepEqual(counts.rows[0], { sources: 1, revisions: 1, runs: 1 })
  })

  await t.test('a human revision wins the compare-and-swap race and cannot be overwritten', async () => {
    const articleId = await createArticle()
    await as(client, 'authenticated', claimsA,
      "SELECT * FROM ap.capture_editorial_article_source($1,'text',NULL,NULL,$2,NULL,$3)",
      [articleId, 'Texto fonte preservado para corrida.', randomUUID()])
    const claim = await as(client, 'authenticated', claimsA,
      'SELECT * FROM ap.claim_editorial_ai_draft($1,$2)', [articleId, randomUUID()])
    await as(client, 'authenticated', claimsA,
      "SELECT * FROM ap.save_editorial_article_draft($1,'Edição humana vence','Conteúdo humano suficientemente longo para persistir.',$2,0)",
      [articleId, randomUUID()])
    const completion = await as(client, 'service_role', { role: 'service_role' },
      "SELECT * FROM ap.complete_editorial_ai_draft($1,$2::jsonb,'anthropic','test-model',100,50,900)",
      [claim.rows[0].run_id, JSON.stringify(draft)])
    assert.equal(completion.rows[0].applied, false)
    assert.equal(completion.rows[0].error_code, 'EDITORIAL_AI_REVISION_CONFLICT')
    const latest = await client.query('SELECT headline, revision_kind FROM ap.editorial_article_revisions WHERE article_id=$1 ORDER BY revision_number DESC LIMIT 1', [articleId])
    assert.equal(latest.rows[0].headline, 'Edição humana vence')
    assert.equal(latest.rows[0].revision_kind, 'draft_checkpoint')
  })

  await t.test('link source keeps scraper output and URL distinct from the AI revision', async () => {
    const url = 'https://example.com/noticia-de-teste'
    const created = await as(client, 'authenticated', claimsA,
      `SELECT * FROM ap.start_editorial_article_direct('link', $1, $2)`, [url, randomUUID()])
    const articleId = created.rows[0].id
    const sourceBody = 'Conteúdo retornado pelo scraper existente para a certificação do caminho de link.'
    await as(client, 'authenticated', claimsA,
      "SELECT * FROM ap.capture_editorial_article_source($1,'link',$2,'Título fonte',$3,'https://example.com/image.jpg',$4)",
      [articleId, url, sourceBody, randomUUID()])
    const claim = await as(client, 'authenticated', claimsA,
      'SELECT * FROM ap.claim_editorial_ai_draft($1,$2)', [articleId, randomUUID()])
    assert.equal(claim.rows[0].source_url, url)
    assert.equal(claim.rows[0].source_body, sourceBody)
    await as(client, 'service_role', { role: 'service_role' },
      "SELECT ap.fail_editorial_ai_draft($1,'EDITORIAL_AI_PROVIDER_FAILURE','anthropic','test-model',50)",
      [claim.rows[0].run_id])
  })

  await t.test('two concurrent requests acquire only one processing lease', async () => {
    const articleId = await createArticle()
    await as(client, 'authenticated', claimsA,
      "SELECT * FROM ap.capture_editorial_article_source($1,'text',NULL,NULL,$2,NULL,$3)",
      [articleId, 'Texto fonte preservado para testar dois cliques concorrentes.', randomUUID()])
    const secondClient = new pg.Client({ ...connection, database: ctx.databaseName })
    await secondClient.connect()
    try {
      const settled = await Promise.allSettled([
        as(client, 'authenticated', claimsA,
          'SELECT * FROM ap.claim_editorial_ai_draft($1,$2)', [articleId, randomUUID()]),
        as(secondClient, 'authenticated', claimsA,
          'SELECT * FROM ap.claim_editorial_ai_draft($1,$2)', [articleId, randomUUID()]),
      ])
      assert.equal(settled.filter(result => result.status === 'fulfilled').length, 1)
      assert.equal(settled.filter(result => result.status === 'rejected').length, 1)
      assert.match(String(settled.find(result => result.status === 'rejected').reason), /EDITORIAL_AI_DRAFT_IN_PROGRESS/)
      const active = await client.query("SELECT count(*)::int AS count FROM ap.editorial_ai_draft_runs WHERE article_id=$1 AND status='processing'", [articleId])
      assert.equal(active.rows[0].count, 1)
    } finally {
      await secondClient.end()
    }
  })

  await t.test('cross-tenant, unrelated users and missing articles are denied', async () => {
    const articleId = await createArticle()
    await assert.rejects(
      as(client, 'authenticated', { sub: staffB, role: 'authenticated' },
        'SELECT * FROM ap.claim_editorial_ai_draft($1,$2)', [articleId, randomUUID()]),
      /EDITORIAL_WORKFLOW_DISABLED|ARTICLE_NOT_FOUND/)
    await assert.rejects(
      as(client, 'authenticated', { sub: outsiderA, role: 'authenticated' },
        'SELECT * FROM ap.claim_editorial_ai_draft($1,$2)', [articleId, randomUUID()]),
      /FORBIDDEN/)
    await assert.rejects(
      as(client, 'authenticated', claimsA,
        'SELECT * FROM ap.claim_editorial_ai_draft($1,$2)', [randomUUID(), randomUUID()]),
      /ARTICLE_NOT_FOUND/)
  })

  const productionRows = await client.query('SELECT count(*)::int AS count FROM ap.candidate_news')
  assert.equal(productionRows.rows[0].count, 0, 'AI never creates candidate_news')
})
