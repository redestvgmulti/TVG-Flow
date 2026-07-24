import assert from 'node:assert/strict'
import pg from 'pg'

const { Client } = pg
const connectionString = process.env.TEST_DATABASE_URL

if (!connectionString) {
  throw new Error('TEST_DATABASE_URL is required')
}

const CLIENT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const USER_ID = '11111111-1111-4111-8111-111111111111'
const TITLE_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'

const delay = milliseconds =>
  new Promise(resolve => setTimeout(resolve, milliseconds))

async function connect() {
  const client = new Client({ connectionString })
  await client.connect()
  return client
}

async function beginAsServiceRole(client) {
  await client.query('begin')
  await client.query('set local role service_role')
  await client.query(
    `select set_config(
       'request.jwt.claims',
       '{"role":"service_role","sub":"${USER_ID}"}',
       true
     )`,
  )
}

async function callRotation(client, key, title = 'Concurrent request') {
  const { rows } = await client.query(
    `select ap.create_candidate_with_sponsors(
       $1::uuid,
       $2::uuid,
       'feed',
       'default',
       1::smallint,
       $3,
       'Concurrent content',
       null,
       null,
       'Category',
       $4::uuid,
       $5::uuid,
       'master_v1',
       '{"master_template_uuid":"future-master"}'::jsonb
     ) as result`,
    [CLIENT_ID, key, title, USER_ID, TITLE_ID],
  )
  return rows[0].result
}

const admin = await connect()
const sessionA = await connect()
const sessionB = await connect()

try {
  await admin.query(`
    truncate table
      ap.candidate_news,
      ap.render_sponsor_rotation_state,
      ap.render_sponsor_scope_memberships,
      ap.render_sponsors,
      ap.visual_titles,
      ap.template_queue_state,
      ap.templates,
      public.cliente_profissionais,
      public.clientes
    cascade
  `)

  await admin.query(
    `insert into public.clientes (id, nome)
     values ($1, 'Concurrent client')`,
    [CLIENT_ID],
  )
  await admin.query(
    `insert into public.cliente_profissionais (
       cliente_id,
       profissional_id,
       ativo
     ) values ($1, $2, true)`,
    [CLIENT_ID, USER_ID],
  )
  await admin.query(
    `insert into ap.templates (
       id,
       empresa_id,
       placid_template_uuid,
       nome,
       ordem,
       tipo,
       template_set
     ) values
       ('10000000-0000-4000-8000-000000000001', $1, 'feed-1', 'Feed 1', 0, 'feed', 'default'),
       ('10000000-0000-4000-8000-000000000002', $1, 'feed-2', 'Feed 2', 1, 'feed', 'default')`,
    [CLIENT_ID],
  )
  await admin.query(
    `insert into ap.visual_titles (
       id,
       cliente_id,
       nome,
       slug,
       asset_bucket,
       asset_path,
       asset_version,
       sha256,
       formatos
     ) values (
       $1,
       $2,
       'Esporte',
       'esporte',
       'ap-images',
       'visual-titles/a/esporte/v1.png',
       'v1',
       repeat('e', 64),
       array['feed', 'reels']::text[]
     )`,
    [TITLE_ID, CLIENT_ID],
  )
  await admin.query(
    `insert into ap.render_sponsors (
       id,
       cliente_id,
       nome,
       slug,
       asset_bucket,
       asset_path,
       asset_version,
       sha256
     ) values
       ('00000000-0000-4000-8000-000000000001', $1, 'A', 'a', 'ap-images', 'sponsors/a/a.png', 'a1', repeat('a', 64)),
       ('00000000-0000-4000-8000-000000000002', $1, 'B', 'b', 'ap-images', 'sponsors/a/b.png', 'b1', repeat('b', 64))`,
    [CLIENT_ID],
  )
  await admin.query(
    `insert into ap.render_sponsor_scope_memberships (
       sponsor_id,
       cliente_id,
       template_set,
       content_type,
       ordem
     ) values
       ('00000000-0000-4000-8000-000000000001', $1, 'default', 'feed', 0),
       ('00000000-0000-4000-8000-000000000002', $1, 'default', 'feed', 1)`,
    [CLIENT_ID],
  )

  await beginAsServiceRole(sessionA)
  const first = await callRotation(
    sessionA,
    '90000000-0000-4000-8000-000000000001',
    'Concurrent A',
  )

  await beginAsServiceRole(sessionB)
  let secondSettled = false
  const secondPromise = callRotation(
    sessionB,
    '90000000-0000-4000-8000-000000000002',
    'Concurrent B',
  ).finally(() => {
    secondSettled = true
  })

  await delay(250)
  assert.equal(
    secondSettled,
    false,
    'second transaction did not wait for the locked rotation path',
  )

  await sessionA.query('commit')
  const second = await secondPromise
  await sessionB.query('commit')

  assert.equal(
    first.sponsor_selection.items[0].name,
    'A',
    'first concurrent transaction did not select A',
  )
  assert.equal(
    second.sponsor_selection.items[0].name,
    'B',
    'second concurrent transaction did not select B',
  )
  assert.notEqual(
    first.sponsor_selection.items[0].sponsor_id,
    second.sponsor_selection.items[0].sponsor_id,
    'concurrent transactions selected the same sponsor',
  )

  const afterDistinct = await admin.query(
    `select
       (select count(*)::int from ap.candidate_news) as candidates,
       (select current_index
        from ap.render_sponsor_rotation_state
        where cliente_id = $1
          and template_set = 'default'
          and content_type = 'feed') as sponsor_cursor,
       (select sum(uso_total)::int
        from ap.templates
        where empresa_id = $1
          and template_set = 'default'
          and tipo = 'feed') as template_usage`,
    [CLIENT_ID],
  )
  assert.deepEqual(afterDistinct.rows[0], {
    candidates: 2,
    sponsor_cursor: 0,
    template_usage: 2,
  })

  await beginAsServiceRole(sessionA)
  const sameKeyFirst = await callRotation(
    sessionA,
    '90000000-0000-4000-8000-000000000003',
    'Same idempotency key',
  )

  await beginAsServiceRole(sessionB)
  let retrySettled = false
  const retryPromise = callRotation(
    sessionB,
    '90000000-0000-4000-8000-000000000003',
    'Same idempotency key',
  ).finally(() => {
    retrySettled = true
  })

  await delay(250)
  assert.equal(
    retrySettled,
    false,
    'same-key retry did not wait for the idempotency lock',
  )

  await sessionA.query('commit')
  const sameKeyRetry = await retryPromise
  await sessionB.query('commit')

  assert.equal(sameKeyRetry.reused, true)
  assert.equal(
    sameKeyFirst.candidate_news.id,
    sameKeyRetry.candidate_news.id,
    'same-key concurrent retry returned another candidate',
  )
  assert.deepEqual(
    sameKeyFirst.render_snapshot,
    sameKeyRetry.render_snapshot,
    'same-key concurrent retry rebuilt the snapshot',
  )

  const afterRetry = await admin.query(
    `select
       count(*)::int as candidates,
       count(*) filter (
         where idempotency_key =
           '90000000-0000-4000-8000-000000000003'
       )::int as same_key_candidates,
       (select current_index
        from ap.render_sponsor_rotation_state
        where cliente_id = $1
          and template_set = 'default'
          and content_type = 'feed') as sponsor_cursor,
       (select sum(uso_total)::int
        from ap.templates
        where empresa_id = $1
          and template_set = 'default'
          and tipo = 'feed') as template_usage
     from ap.candidate_news`,
    [CLIENT_ID],
  )

  assert.deepEqual(afterRetry.rows[0], {
    candidates: 3,
    same_key_candidates: 1,
    sponsor_cursor: 1,
    template_usage: 3,
  })

  console.log(
    JSON.stringify({
      status: 'PASS',
      distinctConcurrentSelections: ['A', 'B'],
      sameKeyReused: true,
      candidateCount: 3,
      sponsorCursor: 1,
      templateUsage: 3,
    }),
  )
} finally {
  await Promise.allSettled([
    sessionA.query('rollback'),
    sessionB.query('rollback'),
  ])
  await Promise.allSettled([
    admin.end(),
    sessionA.end(),
    sessionB.end(),
  ])
}
