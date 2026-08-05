import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import pg from 'pg'

const enabled = process.env.RUN_LOCAL_TERRITORIAL_SQL === '1'
const connection = {
  host: process.env.LOCAL_PG_HOST || '127.0.0.1',
  port: Number(process.env.LOCAL_PG_PORT || 54322),
  user: process.env.LOCAL_PG_USER || 'postgres',
  password: process.env.LOCAL_PG_PASSWORD || 'postgres',
  database: process.env.LOCAL_PG_DATABASE || 'postgres',
}

async function connectedClient() {
  const client = new pg.Client(connection)
  await client.connect()
  return client
}

test('concurrent regional reservations never consume the same sponsor position', { skip: !enabled }, async () => {
  const ids = {
    tenant: randomUUID(),
    user: randomUUID(),
    group: randomUUID(),
    title: randomUUID(),
    region: randomUUID(),
    sponsor1: randomUUID(),
    sponsor2: randomUUID(),
    sponsor3: randomUUID(),
    sponsor4: randomUUID(),
    request1: randomUUID(),
    request2: randomUUID(),
  }
  const admin = await connectedClient()
  const first = await connectedClient()
  const second = await connectedClient()

  try {
    await admin.query('BEGIN')
    await admin.query(
      'INSERT INTO public.clientes (id, nome) VALUES ($1, $2)',
      [ids.tenant, 'Concurrent Composer Tenant'],
    )
    await admin.query(
      'INSERT INTO auth.users (id, email) VALUES ($1, $2)',
      [ids.user, `composer-${ids.user}@example.test`],
    )
    await admin.query(
      `INSERT INTO public.cliente_profissionais
        (cliente_id, profissional_id, funcao, ativo)
       VALUES ($1, $2, 'editor', true)`,
      [ids.tenant, ids.user],
    )
    await admin.query(
      'INSERT INTO ap.territorial_composer_features (cliente_id, enabled) VALUES ($1, true)',
      [ids.tenant],
    )
    await admin.query(
      `INSERT INTO ap.visual_title_groups
        (id, cliente_id, nome, slug, ordem, ativo)
       VALUES ($1, $2, 'EDITORIAL', 'editorial-concurrency', 0, true)`,
      [ids.group, ids.tenant],
    )
    await admin.query(
      `INSERT INTO ap.visual_titles
        (id, cliente_id, group_id, nome, slug, asset_bucket, asset_path,
         asset_version, sha256, ativo, ordem, formatos, tipo)
       VALUES
        ($1, $2, $3, 'Editorial Concurrent', 'editorial-concurrent',
         'ap-images', $4, 'title-v1', $5, true, 0,
         ARRAY['feed','reels']::text[], 'editorial')`,
      [
        ids.title,
        ids.tenant,
        ids.group,
        `visual-titles/${ids.tenant}/editorial.png`,
        '1'.repeat(64),
      ],
    )
    await admin.query(
      `INSERT INTO ap.territorial_regions
        (id, cliente_id, nome, slug, asset_bucket, asset_path,
         asset_version, sha256, ativo)
       VALUES
        ($1, $2, 'Concurrent Region', 'concurrent-region', 'ap-images',
         $3, 'region-v1', $4, true)`,
      [
        ids.region,
        ids.tenant,
        `regions/${ids.tenant}/region.png`,
        '2'.repeat(64),
      ],
    )
    await admin.query(
      `INSERT INTO ap.territorial_composer_templates
        (cliente_id, content_type, master_template_uuid, layer_map, ativo)
       VALUES ($1, 'feed', 'composer_feed_concurrency', $2::jsonb, true)`,
      [
        ids.tenant,
        JSON.stringify({
          headline: 'titulo-materia',
          news_image: 'news-image',
          visual_title: 'titulo-png',
          footer_slot_1: 'regiao-1',
          footer_slot_2: 'patrocinador-1',
          footer_slot_3: 'patrocinador-2',
        }),
      ],
    )

    for (const [index, sponsorId] of [
      ids.sponsor1,
      ids.sponsor2,
      ids.sponsor3,
      ids.sponsor4,
    ].entries()) {
      await admin.query(
        `INSERT INTO ap.render_sponsors
          (id, cliente_id, nome, slug, asset_bucket, asset_path,
           asset_version, sha256, ativo, created_at)
         VALUES ($1, $2, $3, $4, 'ap-images', $5, 'sponsor-v1', $6,
                 true, '2026-08-04 12:00:00+00'::timestamptz + ($7 * interval '1 second'))`,
        [
          sponsorId,
          ids.tenant,
          `Sponsor ${index + 1}`,
          `sponsor-concurrent-${index + 1}`,
          `sponsors/${ids.tenant}/${index + 1}.png`,
          String(index + 3).repeat(64),
          index,
        ],
      )
      await admin.query(
        `INSERT INTO ap.territorial_region_sponsors
          (cliente_id, region_id, sponsor_id, ativo, created_at)
         VALUES ($1, $2, $3, true,
                 '2026-08-04 12:00:00+00'::timestamptz + ($4 * interval '1 second'))`,
        [ids.tenant, ids.region, sponsorId, index],
      )
    }
    await admin.query('COMMIT')

    const claims = JSON.stringify({ role: 'authenticated', sub: ids.user })
    await Promise.all([
      first.query("SELECT set_config('request.jwt.claims', $1, false)", [claims]),
      second.query("SELECT set_config('request.jwt.claims', $1, false)", [claims]),
    ])

    const createSql = `
      SELECT ap.create_territorial_composer_candidate(
        $1, $2, 'feed', 'editorial', $3, 'Concurrent body text',
        NULL, 'https://local.test/source.png', 'DESTAQUE',
        $4, NULL, $5, '[]'::jsonb
      ) AS result
    `
    const [one, two] = await Promise.all([
      first.query(createSql, [
        ids.tenant,
        ids.request1,
        'Concurrent headline one',
        ids.region,
        ids.title,
      ]),
      second.query(createSql, [
        ids.tenant,
        ids.request2,
        'Concurrent headline two',
        ids.region,
        ids.title,
      ]),
    ])

    const selectedOne = one.rows[0].result.candidate_news.render_snapshot
      .sponsor_selection.items.map(item => item.sponsor_id)
    const selectedTwo = two.rows[0].result.candidate_news.render_snapshot
      .sponsor_selection.items.map(item => item.sponsor_id)

    assert.equal(selectedOne.length, 2)
    assert.equal(selectedTwo.length, 2)
    assert.equal(new Set([...selectedOne, ...selectedTwo]).size, 4)
  } finally {
    await admin.query('ROLLBACK').catch(() => {})
    await admin.query('BEGIN').catch(() => {})
    await admin.query(
      `DELETE FROM ap.candidate_news WHERE cliente_id = $1;
       DELETE FROM ap.territorial_sponsor_reservations WHERE cliente_id = $1;
       DELETE FROM ap.territorial_sponsor_rotation_state WHERE cliente_id = $1;
       DELETE FROM ap.territorial_region_sponsors WHERE cliente_id = $1;
       DELETE FROM ap.render_sponsors WHERE cliente_id = $1;
       DELETE FROM ap.territorial_composer_templates WHERE cliente_id = $1;
       DELETE FROM ap.territorial_regions WHERE cliente_id = $1;
       DELETE FROM ap.visual_titles WHERE cliente_id = $1;
       DELETE FROM ap.visual_title_groups WHERE cliente_id = $1;
       DELETE FROM ap.territorial_composer_features WHERE cliente_id = $1;
       DELETE FROM public.cliente_profissionais WHERE cliente_id = $1;
       DELETE FROM auth.users WHERE id = $2;
       DELETE FROM public.clientes WHERE id = $1;`,
      [ids.tenant, ids.user],
    ).catch(() => {})
    await admin.query('COMMIT').catch(() => {})
    await Promise.allSettled([admin.end(), first.end(), second.end()])
  }
})
