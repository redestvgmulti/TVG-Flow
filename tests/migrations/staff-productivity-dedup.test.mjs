import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { as, createFixtureDatabase, dropFixtureDatabase, runtimeEnabled } from './2b1-fixture.mjs'

const fix = await readFile(new URL('../../supabase/migrations/20261023173440_fix_staff_productivity_double_count.sql', import.meta.url), 'utf8')
const original = await readFile(new URL('../../supabase/migrations/20260902181500_r1_editorial_reporting_and_work.sql', import.meta.url), 'utf8')
const originalReport = original.slice(original.indexOf('CREATE OR REPLACE FUNCTION ap.get_staff_productivity_report('), original.indexOf('-- 2. Create/Adjust'))
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const claims = sub => ({ sub, role: 'authenticated' })
const admin = id(3), staff = id(4), otherStaff = id(5), cliente = id(2)
const foreignAdmin = id(13), foreignStaff = id(14), foreignCliente = id(12)

test('staff productivity counts editorial deliveries once after render', { skip: !runtimeEnabled }, async t => {
  const ctx = await createFixtureDatabase('tvg_staff_report_dedup')
  t.after(() => dropFixtureDatabase(ctx))
  const { client } = ctx

  await client.query(`
    CREATE TABLE public.tarefas (
      id uuid PRIMARY KEY, cliente_id uuid, assigned_to uuid, completed_by_user_id uuid,
      status text, deleted_at timestamptz, concluida_at timestamptz
    );
    CREATE TABLE public.tarefas_micro (
      id uuid PRIMARY KEY, tarefa_id uuid, profissional_id uuid, status text, finished_at timestamptz
    );
    CREATE TABLE ap.material_production_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      candidate_news_id uuid NOT NULL UNIQUE REFERENCES ap.candidate_news(id),
      cliente_id uuid NOT NULL REFERENCES public.clientes(id),
      creator_user_id uuid NOT NULL REFERENCES public.profissionais(id),
      produced_at timestamptz NOT NULL
    );
    INSERT INTO public.empresas(id) VALUES ('${id(1)}'), ('${id(11)}');
    INSERT INTO public.clientes(id, empresa_id) VALUES ('${cliente}', '${id(1)}'), ('${foreignCliente}', '${id(11)}');
    INSERT INTO public.profissionais(id, role) VALUES
      ('${admin}', 'admin'), ('${staff}', 'staff'), ('${otherStaff}', 'staff'),
      ('${foreignAdmin}', 'admin'), ('${foreignStaff}', 'staff');
    INSERT INTO public.operational_clients(profissional_id, cliente_id) VALUES
      ('${admin}', '${cliente}'), ('${staff}', '${cliente}'), ('${otherStaff}', '${cliente}'),
      ('${foreignAdmin}', '${foreignCliente}'), ('${foreignStaff}', '${foreignCliente}');
    INSERT INTO public.cliente_profissionais(profissional_id, cliente_id)
      SELECT profissional_id, cliente_id FROM public.operational_clients;
  `)
  for (const user of [admin, foreignAdmin]) {
    await as(client, 'authenticated', claims(user), 'SELECT ap.set_editorial_workflow_v1_enabled(true)')
  }
  await client.query(originalReport)
  await client.query(fix)
  // The migration is safe to reapply and retains the existing function ACL.
  await client.query(fix)

  const { today, yesterday } = (await client.query(`
    SELECT date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo'
      + interval '1 hour' AS today,
      date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo'
      - interval '1 day' + interval '1 hour' AS yesterday
  `)).rows[0]
  const start = new Date(today.getTime() - 3 * 86400000)
  const end = new Date(today.getTime() + 86400000)
  const day = date => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(date)

  async function report(from = start, to = end, user = admin, tenant = cliente) {
    return (await as(client, 'authenticated', claims(user),
      'SELECT ap.get_staff_productivity_report($1, $2, $3) AS report', [tenant, from, to])).rows[0].report
  }
  function row(result, user = staff) {
    const found = result.staff.find(item => item.staff_id === user)
    assert.ok(found, 'staff member must remain visible')
    return found
  }
  function totals(item, completed, todayCount, daily) {
    assert.equal(item.articles_completed, completed)
    assert.equal(item.articles_today, todayCount)
    assert.deepEqual(item.daily_articles, daily)
  }
  async function article({ owner = staff, at = today, finalized = true } = {}) {
    const created = (await as(client, 'authenticated', claims(owner),
      "SELECT * FROM ap.start_editorial_article_direct('text', NULL, $1)", [randomUUID()])).rows[0]
    if (finalized) {
      await as(client, 'authenticated', claims(owner),
        "SELECT ap.finalize_editorial_article($1, 'Headline', 'Body', $2)", [created.id, randomUUID()])
      await client.query('UPDATE ap.editorial_articles SET first_finalized_at=$2, finalized_at=$2 WHERE id=$1', [created.id, at])
    }
    return created.id
  }
  async function production({ articleId, owner = staff, tenant = cliente, at = today } = {}) {
    const candidateId = randomUUID()
    await client.query("INSERT INTO ap.candidate_news(id, cliente_id, status, criado_por_user_id) VALUES ($1,$2,'pending_render',$3)",
      [candidateId, tenant, owner])
    if (articleId) {
      await client.query('UPDATE ap.editorial_articles SET candidate_news_id=$2 WHERE id=$1', [articleId, candidateId])
    }
    await client.query('INSERT INTO ap.material_production_events(candidate_news_id, cliente_id, creator_user_id, produced_at) VALUES ($1,$2,$3,$4)',
      [candidateId, tenant, owner, at])
  }
  async function isolated(name, fn) {
    await t.test(name, async () => {
      await client.query('BEGIN')
      try { await fn() } finally { await client.query('ROLLBACK') }
    })
  }

  await isolated('legacy production without an editorial article remains counted', async () => {
    await production()
    totals(row(await report()), 1, 1, [{ date: day(today), count: 1 }])
  })
  await isolated('editorial finalization counts before any render exists', async () => {
    await article()
    totals(row(await report()), 1, 1, [{ date: day(today), count: 1 }])
  })
  await isolated('10 finalized and rendered articles count as 10, not 20', async () => {
    for (let i = 0; i < 10; i++) await production({ articleId: await article() })
    totals(row(await report()), 10, 10, [{ date: day(today), count: 10 }])
    // Prove this fixture reproduces the original bug, rather than only
    // checking the new query against itself.
    await client.query(originalReport)
    totals(row(await report()), 20, 20, [{ date: day(today), count: 20 }])
  })
  await isolated('independent deliveries at the same timestamp are not collapsed', async () => {
    await article()
    await production()
    totals(row(await report()), 2, 2, [{ date: day(today), count: 2 }])
  })
  await isolated('a delayed render does not move yesterday\'s delivery into today', async () => {
    await production({ articleId: await article({ at: yesterday }) })
    totals(row(await report()), 1, 0, [{ date: day(yesterday), count: 1 }])
    totals(row(await report(today, end)), 0, 0, [])
  })
  await isolated('a render attributed to another user does not create another delivery', async () => {
    await production({ articleId: await article(), owner: otherStaff })
    const result = await report()
    totals(row(result), 1, 1, [{ date: day(today), count: 1 }])
    totals(row(result, otherStaff), 0, 0, [])
  })
  await isolated('a linked record without editorial finalization retains legacy production', async () => {
    await production({ articleId: await article({ finalized: false }) })
    totals(row(await report()), 1, 1, [{ date: day(today), count: 1 }])
  })
  await isolated('report start is inclusive and end is exclusive', async () => {
    await production({ articleId: await article() })
    totals(row(await report(today, end)), 1, 1, [{ date: day(today), count: 1 }])
    // The today metric deliberately remains independent of the chosen period.
    totals(row(await report(start, today)), 0, 1, [])
  })
  await isolated('unrelated tenant deliveries remain isolated', async () => {
    await production({ articleId: await article() })
    await production({ articleId: await article({ owner: foreignStaff }), owner: foreignStaff, tenant: foreignCliente })
    const result = await report()
    assert.equal(result.staff.length, 3)
    assert.ok(!result.staff.some(item => item.staff_id === foreignStaff))
    totals(row(result), 1, 1, [{ date: day(today), count: 1 }])
    const foreign = await report(start, end, foreignAdmin, foreignCliente)
    totals(row(foreign, foreignStaff), 1, 1, [{ date: day(today), count: 1 }])
  })
  await t.test('admin access checks, validation and anonymous restrictions survive', async () => {
    const acl = (await client.query(`SELECT
      has_function_privilege('anon', 'ap.get_staff_productivity_report(uuid,timestamptz,timestamptz,text)', 'EXECUTE') AS anon,
      has_function_privilege('authenticated', 'ap.get_staff_productivity_report(uuid,timestamptz,timestamptz,text)', 'EXECUTE') AS authenticated
    `)).rows[0]
    assert.deepEqual(acl, { anon: false, authenticated: true })
    for (const [operation, message] of [
      [() => report(start, end, staff), /EDITORIAL_ADMIN_REQUIRED/],
      [() => report(start, end, admin, foreignCliente), /EDITORIAL_ADMIN_REQUIRED/],
      [() => report(end, start), /REPORT_RANGE_INVALID/],
      [() => as(client, 'authenticated', claims(admin),
        "SELECT ap.get_staff_productivity_report($1,$2,$3,'invalid')", [cliente, start, end]), /REPORT_TIMEZONE_INVALID/],
    ]) {
      await assert.rejects(operation, message)
    }
  })
})
