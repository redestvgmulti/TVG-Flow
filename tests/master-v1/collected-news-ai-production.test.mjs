import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../../', import.meta.url)
const source = path => readFile(new URL(path, root), 'utf8')

test('one-click production composes the canonical collection, adoption and article RPCs', async () => {
  const migration = await source('supabase/migrations/20260920192721_collected_news_one_click_production.sql')

  assert.match(migration, /CREATE OR REPLACE FUNCTION ap\.start_collected_news_editorial_production/)
  assert.match(migration, /public\.require_single_operational_cliente_id\(\)/)
  assert.match(migration, /ap\.require_editorial_admin_access\(v_cliente_id\)/)
  assert.match(migration, /ap\.approve_collected_news\(v_cliente_id, v_collected\.id, NULL\)/)
  assert.match(migration, /ap\.adopt_news_backlog_item\(v_backlog\.id, v_cliente_id\)/)
  assert.match(migration, /ap\.start_editorial_article_from_backlog\(v_backlog\.id, p_request_id\)/)
  assert.match(migration, /FOR UPDATE/)
  assert.match(migration, /COLLECTED_NEWS_ALREADY_IN_PRODUCTION/)
  assert.match(migration, /responsible_user_id IS DISTINCT FROM v_user_id/)
  assert.match(migration, /status IN \('adopted', 'in_production'\)/)
  assert.match(migration, /source_captured/)
})

test('source sufficiency and scraper fallback preserve complete collected provenance append-only', async () => {
  const [migration, original] = await Promise.all([
    source('supabase/migrations/20260920192721_collected_news_one_click_production.sql'),
    source('supabase/migrations/20260920002600_editorial_ai_draft_vertical_slice.sql'),
  ])

  assert.match(migration, /length\(btrim\(COALESCE\(v_collected\.content, ''\)\)\) >= 200/)
  assert.match(migration, /COLLECTED_NEWS_SCRAPE_REQUIRED/)
  assert.match(migration, /'content_origin', CASE WHEN v_source_sufficient THEN 'collected_news' ELSE 'ap-link-scraper' END/)
  for (const field of [
    'source_collected_news_id', 'source_backlog_id', 'url_original', 'canonical_url',
    'original_title', 'original_excerpt', 'original_content', 'original_image_url',
    'source_name', 'published_at', 'collected_at', 'last_seen_at', 'parser_version',
    'collected_metadata',
  ]) assert.match(migration, new RegExp(field))
  assert.match(original, /editorial_article_sources_append_only/)
  assert.match(migration, /IF FOUND THEN RETURN v_source; END IF/)
})

test('a missing or insecure collected image is scraped independently from text sufficiency', async () => {
  const [repair, wizard, scraper] = await Promise.all([
    source('supabase/migrations/20260920201120_repair_collected_image_and_ai_retry.sql'),
    source('src/components/editorial/CanonicalArticleWizard.jsx'),
    source('supabase/functions/ap-link-scraper/index.ts'),
  ])

  assert.match(wizard, /!\/\^https:\\\/\\\/\/i\.test\(capturedImageUrl\) && !sourceImageUrl/)
  assert.match(wizard, /sourceImageRef\.current = sourceImageUrl[\s\S]+\/\^https:\\\/\\\/\/i\.test\(capturedImageUrl\)/)
  assert.match(wizard, /setFormData\(previous => \(\{ \.\.\.previous, image_url: sourceImageRef\.current \}\)\)/)
  assert.match(repair, /v_scraped_image := NULLIF\(btrim\(p_scraped_image_url\), ''\)/)
  assert.match(repair, /WHEN v_scraped_image ~\* '\^https:\/\/' THEN v_scraped_image/)
  assert.match(repair, /'original_image_url', v_collected\.image_url/)
  assert.match(repair, /'scraped_image_url', v_scraped_image/)
  assert.match(scraper, /if \(url\.protocol === "http:"\) url\.protocol = "https:"/)
})

test('CollectedNewsPanel exposes Produzir as the single preparation action', async () => {
  const panel = await source('src/components/editorial/CollectedNewsPanel.jsx')

  assert.match(panel, /\}\s*Produzir/)
  assert.match(panel, /await onProduce\(item\)/)
  assert.match(panel, /Esta matéria já está sendo produzida por outro usuário\./)
  assert.doesNotMatch(panel, /Aprovar pauta|ApproveCollectedNewsModal|approve_collected_news/)
})

test('the canonical five-step modal prepares collected news invisibly and locally', async () => {
  const [wizard, articleWizard, admin, service] = await Promise.all([
    source('src/components/editorial/CanonicalArticleWizard.jsx'),
    source('src/components/editorial/ArticleWizard.jsx'),
    source('src/pages/admin/AutoPublisher.jsx'),
    source('src/services/editorialArticlesService.js'),
  ])

  assert.match(admin, /startCollectedNewsEditorialProduction/)
  assert.match(admin, /onProduce=\{startCanonicalProductionFromCollected\}/)
  assert.match(admin, /auto_prepare: true/)
  assert.match(service, /start_collected_news_editorial_production/)
  assert.match(service, /capture_collected_news_article_source/)
  assert.match(service, /functions\.invoke\('ap-link-scraper'/)
  assert.match(wizard, /originBacklog\.source_requires_scrape/)
  assert.match(wizard, /captureCollectedNewsArticleSource/)
  assert.match(wizard, /prepareEditorialAiDraft/)
  assert.match(wizard, /EDITORIAL_AI_DRAFT_IN_PROGRESS/)
  assert.match(wizard, /waitForPreparedDraft/)
  assert.match(wizard, /Number\(current\.revision_number \|\| 0\) > 0/)
  assert.match(wizard, /preparedRef\.current && !hasPreparedDraft/)
  assert.match(wizard, /saveEditorialArticleDraft/)
  assert.match(wizard, /expectedRevisionNumber: revisionNumberRef\.current/)
  assert.match(articleWizard, /Preparando matéria\.\.\./)
  assert.match(articleWizard, />Tentar novamente</)
  assert.match(articleWizard, /Salvar rascunho/)
  assert.doesNotMatch(articleWizard, /Gerar com IA|Flow\.IA|chat/i)
})

test('AI preparation remains editorial-only and human production choices stay editable', async () => {
  const [migration, wizard, edge] = await Promise.all([
    source('supabase/migrations/20260920192721_collected_news_one_click_production.sql'),
    source('src/components/editorial/CanonicalArticleWizard.jsx'),
    source('supabase/functions/ap-editorial-ai-draft/index.ts'),
  ])

  assert.doesNotMatch(migration, /(?:INSERT INTO|UPDATE|DELETE FROM)\s+ap\.candidate_news/i)
  assert.doesNotMatch(migration, /ap-render|placid|instagram|approve_editorial_article_for_render/i)
  assert.doesNotMatch(edge, /candidate_news|ap-render|placid|instagram|approve_editorial/i)
  assert.match(wizard, /saveEditorialArticleProductionIntent/)
  assert.match(wizard, /validateProductionIntentStep/)
  assert.match(wizard, /visual_title_id/)
  assert.match(wizard, /region_id/)
  assert.match(wizard, /city_id/)
  assert.doesNotMatch(wizard, /location[\s\S]{0,120}city_id\s*=/)
})

test('tenant and execution grants fail closed for collected production', async () => {
  const migration = await source('supabase/migrations/20260920192721_collected_news_one_click_production.sql')

  assert.match(migration, /collected\.cliente_id = v_cliente_id/)
  assert.match(migration, /backlog\.normalized_url/)
  assert.match(migration, /REVOKE ALL ON FUNCTION ap\.start_collected_news_editorial_production\(uuid, uuid\) FROM PUBLIC, anon, service_role/)
  assert.match(migration, /GRANT EXECUTE ON FUNCTION ap\.start_collected_news_editorial_production\(uuid, uuid\) TO authenticated/)
  assert.match(migration, /REVOKE ALL ON FUNCTION ap\.capture_collected_news_article_source\(uuid, uuid, text, text, text, uuid\) FROM PUBLIC, anon, service_role/)
})
