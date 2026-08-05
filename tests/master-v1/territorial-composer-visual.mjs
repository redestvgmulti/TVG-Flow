import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import pg from 'pg'
import {
  prepareTerritorialComposerRender,
} from '../../supabase/functions/ap-render-engine/territorialRenderContract.ts'

const BASE_URL = process.env.LOCAL_APP_URL || 'http://127.0.0.1:4176'
const SUPABASE_URL = process.env.LOCAL_SUPABASE_URL || 'http://127.0.0.1:54321'
const EMAIL = process.env.LOCAL_TERRITORIAL_EMAIL
const PASSWORD = process.env.LOCAL_TERRITORIAL_PASSWORD
const OUTPUT = path.resolve(
  process.env.TERRITORIAL_VISUAL_OUTPUT ||
    'artifacts/territorial-composer/visual-certification',
)

if (!/^http:\/\/127\.0\.0\.1(?::\d+)?$/.test(BASE_URL)) {
  throw new Error('LOCAL_APP_URL must target 127.0.0.1')
}
if (!/^http:\/\/127\.0\.0\.1(?::\d+)?$/.test(SUPABASE_URL)) {
  throw new Error('LOCAL_SUPABASE_URL must target 127.0.0.1')
}
if (!EMAIL || !PASSWORD) {
  throw new Error('LOCAL_TERRITORIAL_EMAIL and LOCAL_TERRITORIAL_PASSWORD are required')
}

const playwrightUrl = pathToFileURL(path.resolve(
  process.cwd(),
  '..',
  '..',
  'node_modules',
  'playwright',
  'index.mjs',
)).href
const { chromium } = await import(playwrightUrl)
const database = new pg.Client({
  host: process.env.LOCAL_PG_HOST || '127.0.0.1',
  port: Number(process.env.LOCAL_PG_PORT || 54322),
  user: process.env.LOCAL_PG_USER || 'postgres',
  password: process.env.LOCAL_PG_PASSWORD || 'postgres',
  database: process.env.LOCAL_PG_DATABASE || 'postgres',
})

await fs.mkdir(OUTPUT, { recursive: true })
await database.connect()

const tenantId = (await database.query(`
  SELECT id
  FROM public.clientes
  WHERE tipo = 'agencia' AND ativo
  ORDER BY created_at
  LIMIT 1
`)).rows[0]?.id
const userId = (await database.query(
  'SELECT id FROM auth.users WHERE email = $1',
  [EMAIL],
)).rows[0]?.id
assert.ok(tenantId, 'local agency tenant is required')
assert.ok(userId, 'local authenticated user is required')

async function setFeature(enabled) {
  await database.query(`
    INSERT INTO ap.territorial_composer_features (cliente_id, enabled)
    VALUES ($1, $2)
    ON CONFLICT (cliente_id)
    DO UPDATE SET enabled = EXCLUDED.enabled
  `, [tenantId, enabled])
}

async function createMockCandidate(payload, slug) {
  await database.query('BEGIN')
  try {
    await database.query(
      `SELECT set_config(
        'request.jwt.claims',
        jsonb_build_object(
          'role', 'authenticated',
          'sub', $1::text
        )::text,
        true
      )`,
      [userId],
    )
    const created = (await database.query(`
      SELECT ap.create_territorial_composer_candidate(
        $1::uuid,
        $2::uuid,
        $3::text,
        $4::text,
        $5::text,
        $6::text,
        $7::text,
        $8::text,
        $9::text,
        $10::uuid,
        $11::uuid,
        $12::uuid,
        $13::jsonb
      ) AS value
    `, [
      payload.cliente_id,
      payload.idempotency_key,
      payload.content_type,
      payload.composer_mode,
      payload.headline,
      payload.text,
      payload.url_original,
      payload.source_image,
      payload.context_tag,
      payload.region_id,
      payload.city_id,
      payload.visual_title_id,
      JSON.stringify(payload.manual_slots || []),
    ])).rows[0].value

    const candidateId = created.candidate_news.id
    await database.query(`
      SELECT ap.finalize_territorial_composer_candidate(
        $1::uuid,
        $2::text,
        $3::text,
        $4::text,
        $5::jsonb
      )
    `, [
      candidateId,
      `Mock final ${payload.headline}`,
      `Mock caption ${slug}`,
      payload.context_tag,
      JSON.stringify({ local_mock: true, slug }),
    ])
    await database.query(
      'SELECT ap.complete_territorial_composer_render($1::uuid, $2::text)',
      [candidateId, `${BASE_URL}/mock-render/${slug}.png`],
    )
    const candidate = (await database.query(`
      SELECT *
      FROM ap.candidate_news
      WHERE id = $1
    `, [candidateId])).rows[0]
    await database.query('COMMIT')
    return candidate
  } catch (error) {
    await database.query('ROLLBACK')
    throw error
  }
}

function safeFile(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-')
}

async function saveJson(folder, slug, value) {
  const target = path.join(OUTPUT, folder)
  await fs.mkdir(target, { recursive: true })
  await fs.writeFile(
    path.join(target, `${slug}.json`),
    `${JSON.stringify(value, null, 2)}\n`,
    'utf8',
  )
}

async function chooseMode(modal, label) {
  const button = modal.locator('section[aria-label] button').filter({ hasText: label })
  assert.equal(await button.count(), 1, `${label} mode must be unique`)
  await button.click()
}

async function chooseFirstNonEmpty(select) {
  assert.ok(await select.count(), 'select must exist')
  await select.selectOption({ index: 1 })
}

const combinations = [
  ['feed', 'editorial'],
  ['feed', 'cities'],
  ['feed', 'individual'],
  ['reels', 'editorial'],
  ['reels', 'cities'],
  ['reels', 'individual'],
  ['story', 'editorial'],
  ['story', 'cities'],
  ['story', 'individual'],
]
const labels = {
  feed: 'Feed',
  reels: 'Reels',
  story: 'Stories',
  editorial: 'Editorial',
  cities: 'Cidades',
  individual: 'Individual',
}
const runLabel = Date.now()

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const consoleErrors = []
const requestFailures = []
const capturedPayloads = new Map()
page.on('console', message => {
  if (message.type() === 'error') consoleErrors.push(message.text())
})
page.on('requestfailed', request => {
  if (!request.url().startsWith(`${BASE_URL}/mock-render/`)) {
    requestFailures.push(`${request.method()} ${request.url()}`)
  }
})
// The retained local database predates two unrelated legacy columns used by
// current list/runtime reads. Mock only those reads during this visual drill.
await page.route('**/rest/v1/candidate_news?*', async route => {
  if (
    route.request().method() === 'GET' &&
    route.request().url().includes('image_external')
  ) {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'content-range': '*/0' },
      body: '[]',
    })
  } else {
    await route.continue()
  }
})
await page.route('**/rest/v1/master_render_configs?*', async route => {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: { 'content-range': '*/0' },
    body: '[]',
  })
})
await page.route('**/functions/v1/ap-employee-generator', async route => {
  const payload = route.request().postDataJSON()
  const slug = `${payload.content_type}-${payload.composer_mode}`
  capturedPayloads.set(slug, payload)
  const candidate = await createMockCandidate(payload, slug)
  await saveJson('payloads', slug, payload)
  await saveJson('snapshots', slug, candidate.render_snapshot)
  const plan = prepareTerritorialComposerRender(candidate, SUPABASE_URL)
  await saveJson('render-plans', slug, plan)
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      candidate_news: {
        id: candidate.id,
        status: candidate.status,
        render_contract_version: candidate.render_contract_version,
      },
      local_mock: true,
    }),
  })
})

await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' })
await page.locator('#email').fill(EMAIL)
await page.locator('#password').fill(PASSWORD)
await page.locator('form button[type=submit]').click()
await page.waitForURL('**/admin', { timeout: 10_000 })
await page.goto(`${BASE_URL}/admin/autopublisher`, { waitUntil: 'networkidle' })

async function openModal() {
  const button = page.locator('button').filter({ hasText: 'Nova' })
  assert.equal(await button.count(), 1, 'new article button must be unique')
  await button.click()
  const modal = page.locator('.ap-new-article-modal-content')
  await modal.waitFor({ state: 'visible' })
  return modal
}

await setFeature(false)
await page.reload({ waitUntil: 'networkidle' })
let modal = await openModal()
await page.waitForTimeout(600)
const legacyText = await modal.innerText()
assert.match(legacyText, /Selo da matéria/)
assert.match(legacyText, /Finalidade da arte|Não foi possível carregar os modelos visuais/)
assert.doesNotMatch(legacyText, /Modo da composição/)
await modal.screenshot({
  path: path.join(OUTPUT, '00-flag-off-legacy-modal.png'),
})
await modal.getByRole('button', { name: 'Cancelar', exact: true }).click()

await setFeature(true)
await page.reload({ waitUntil: 'networkidle' })

for (const [contentType, mode] of combinations) {
  const slug = safeFile(`${contentType}-${mode}`)
  if (contentType === 'story' && mode === 'individual') {
    await page.setViewportSize({ width: 390, height: 844 })
  } else {
    await page.setViewportSize({ width: 1440, height: 1000 })
  }

  modal = await openModal()
  await page.waitForTimeout(450)
  const formatControl = modal.getByText(labels[contentType], { exact: true })
  assert.equal(await formatControl.count(), 1, `${contentType} format must be unique`)
  await formatControl.click()
  await chooseMode(modal, labels[mode])

  if (mode === 'editorial') {
    const selects = modal.locator('section[aria-label] select')
    assert.equal(await selects.count(), 2)
    await chooseFirstNonEmpty(selects.nth(0))
    await chooseFirstNonEmpty(selects.nth(1))
  } else if (mode === 'cities') {
    const citySearch = modal.locator('input[type=search]')
    assert.equal(await citySearch.count(), 1)
    await citySearch.fill('Cidade')
    const city = modal.locator('section[aria-label] button')
      .filter({ hasText: 'Cidade Atualizada Local 20260804' })
    assert.equal(await city.count(), 1)
    await city.click()
  } else {
    const selects = modal.locator('section[aria-label] select')
    const expectedCount = contentType === 'story' ? 3 : 4
    assert.equal(await selects.count(), expectedCount)
    if (contentType !== 'story') await chooseFirstNonEmpty(selects.nth(0))
    const firstSlotIndex = contentType === 'story' ? 0 : 1
    await chooseFirstNonEmpty(selects.nth(firstSlotIndex))
  }

  await modal.getByPlaceholder('Ex: URGENTE').fill('VALIDAÇÃO LOCAL')
  await modal.getByPlaceholder('Ex: Novo viaduto é inaugurado...').fill(
    `Certificação ${labels[contentType]} ${labels[mode]}`,
  )
  await modal.getByPlaceholder(
    'Escreva a notícia base. A IA revisará e criará a caption com hashtags...',
  ).fill(`Conteúdo isolado para ${slug}.`)
  await modal.locator('textarea').fill(
    `Isolated local content for ${slug} in visual run ${runLabel}.`,
  )
  await modal.locator('input[placeholder="Ex: URGENTE"]').fill(
    'LOCAL VALIDATION',
  )
  await modal.locator('input[placeholder^="Ex: Novo"]').fill(
    `Local certification ${contentType} ${mode} ${runLabel}`,
  )
  if (contentType === 'feed') {
    await modal.getByPlaceholder('https://exemplo.com/foto.jpg').fill(
      `${BASE_URL}/pwa-192x192.png`,
    )
  }

  const dimensions = await modal.evaluate(element => ({
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth,
  }))
  assert.ok(
    dimensions.scrollWidth <= dimensions.clientWidth + 1,
    `${slug} has horizontal overflow`,
  )
  await modal.screenshot({
    path: path.join(OUTPUT, `${slug}-form.png`),
  })
  await modal.locator('button[type=submit]').click()
  await modal.waitFor({ state: 'hidden', timeout: 15_000 })
  assert.ok(capturedPayloads.has(slug), `${slug} payload was not captured`)

  const plan = JSON.parse(await fs.readFile(
    path.join(OUTPUT, 'render-plans', `${slug}.json`),
    'utf8',
  ))
  const layerRows = Object.entries(plan.layers)
    .map(([name, value]) =>
      `<li><strong>${name}</strong><span>${
        'text' in value ? value.text : value.image
      }</span></li>`)
    .join('')
  await page.setContent(`
    <!doctype html>
    <html lang="pt-BR">
      <meta charset="utf-8">
      <style>
        body { margin: 0; min-height: 100vh; display: grid; place-items: center;
          font: 16px/1.4 Inter, system-ui; color: #e2e8f0;
          background: linear-gradient(145deg, #020617, #172554); }
        article { width: min(820px, calc(100vw - 40px)); box-sizing: border-box;
          padding: 34px; border: 1px solid #334155; border-radius: 24px;
          background: rgba(15, 23, 42, .94); box-shadow: 0 24px 80px #0008; }
        header { display: flex; justify-content: space-between; gap: 18px;
          align-items: center; margin-bottom: 24px; }
        h1 { margin: 0; font-size: 27px; }
        em { color: #93c5fd; font-style: normal; font-weight: 700; }
        ul { list-style: none; display: grid; gap: 10px; padding: 0; margin: 0; }
        li { display: grid; grid-template-columns: 190px 1fr; gap: 14px;
          padding: 12px 14px; border-radius: 12px; background: #1e293b; }
        li strong { color: #7dd3fc; }
        li span { overflow-wrap: anywhere; color: #cbd5e1; }
        footer { margin-top: 22px; padding-top: 16px; border-top: 1px solid #334155;
          color: #94a3b8; font-size: 13px; }
      </style>
      <body>
        <article>
          <header>
            <div><em>MOCK LOCAL · sem Placid</em><h1>${labels[contentType]} + ${labels[mode]}</h1></div>
            <strong>${plan.templateId}</strong>
          </header>
          <ul>${layerRows}</ul>
          <footer>Plano produzido exclusivamente a partir do snapshot territorial_composer_v1.</footer>
        </article>
      </body>
    </html>
  `)
  await page.screenshot({
    path: path.join(OUTPUT, `${slug}-preview-mock.png`),
    fullPage: true,
  })
  await page.goto(`${BASE_URL}/admin/autopublisher`, { waitUntil: 'networkidle' })
}

const sanitizedConsoleErrors = consoleErrors.filter(message =>
  !/favicon|mock-render/i.test(message))
assert.deepEqual(sanitizedConsoleErrors, [])
assert.deepEqual(requestFailures, [])

await saveJson('meta', 'certification', {
  base_url: BASE_URL,
  supabase_url: SUPABASE_URL,
  tenant_id: tenantId,
  authenticated_user_id: userId,
  flag_off_legacy_verified: true,
  flag_on_combinations: combinations.map(([format, mode]) => ({ format, mode })),
  console_errors: sanitizedConsoleErrors,
  request_failures: requestFailures,
  placid_called: false,
  local_read_mocks: [
    'candidate_news list missing historical image_external column',
    'master_render_configs missing historical sponsor_count column',
  ],
})

await setFeature(true)
await browser.close()
await database.end()
console.log(`territorial composer visual certification: PASS (${OUTPUT})`)
