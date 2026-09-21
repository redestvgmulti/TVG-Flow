import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../../', import.meta.url)
const source = path => readFile(new URL(path, root), 'utf8')

test('canonical creation uses the same fixed five-step wizard for admin and staff', async () => {
  const [wizard, canonical, admin, staff] = await Promise.all([
    source('src/components/editorial/ArticleWizard.jsx'),
    source('src/components/editorial/CanonicalArticleWizard.jsx'),
    source('src/pages/admin/AutoPublisher.jsx'),
    source('src/pages/admin/EmployeeMode.jsx'),
  ])

  for (const step of ['formato', 'origem', 'detalhes', 'imagem', 'revisao']) {
    assert.match(wizard, new RegExp(`key: '${step}'`))
  }
  assert.match(wizard, /await onBeforeReview\(\)/)
  assert.match(wizard, /Preparando matéria\.\.\./)
  assert.match(wizard, /fixedFiveSteps \|\| sourceImageRequired/)
  assert.match(canonical, /fixedFiveSteps/)
  assert.match(canonical, /submitLabel="Aprovar e gerar arte"/)
  assert.match(canonical, /<ArticleWizard/)
  assert.match(admin, /creationMode === CREATION_MODES\.CANONICAL[\s\S]+<CanonicalArticleWizard/)
  assert.match(staff, /creationMode === CREATION_MODES\.CANONICAL[\s\S]+<CanonicalArticleWizard/)
})

test('invisible AI preserves source then submits the reviewed canonical draft', async () => {
  const [canonical, form, contract] = await Promise.all([
    source('src/components/editorial/CanonicalArticleWizard.jsx'),
    source('src/components/editorial/ArticleForm.jsx'),
    source('src/services/editorialArticleContract.js'),
  ])

  assert.match(canonical, /captureEditorialArticleSource/)
  assert.match(canonical, /prepareEditorialAiDraft/)
  assert.match(canonical, /source_titulo: sourceTitle/)
  assert.match(canonical, /source_conteudo: sourceBody/)
  assert.match(canonical, /finalizeEditorialArticle/)
  assert.match(canonical, /approveEditorialArticleForRender/)
  assert.match(canonical, /dispatchEditorialArticleRender/)
  assert.match(canonical, /article\.status === 'draft' \|\| article\.status === 'editing' \|\| article\.status === 'changes_requested'/)
  assert.match(canonical, /article\.status !== 'dispatched' \|\| !candidateNewsId/)
  assert.match(canonical, /throw Object\.assign\(new Error\('DISPATCH_FAILED'\)/)
  assert.doesNotMatch(canonical, /ap-employee-generator|runEditorialWorkflow|candidate_news.*insert/i)

  // Manual text is source material for the AI, so one non-whitespace
  // character is valid. Only empty inputs remain blocked for both hosts.
  assert.match(canonical, /if \(!sourceTitle\).*SOURCE_TITLE_REQUIRED/)
  assert.match(canonical, /if \(!sourceBody\).*SOURCE_BODY_REQUIRED/)
  assert.doesNotMatch(canonical, /sourceTitle\.length\s*</)
  assert.doesNotMatch(canonical, /sourceBody\.length\s*</)
  assert.doesNotMatch(form, /minLength=/)
  assert.doesNotMatch(form, /Mínimo de/)
  assert.match(contract, /SOURCE_TITLE_REQUIRED:[\s\S]*Informe uma headline para a IA/)
  assert.match(contract, /SOURCE_BODY_REQUIRED:[\s\S]*Informe um texto-base para a IA/)
})

test('a human image replacement after AI preparation wins without duplicate uploads', async () => {
  const canonical = await source('src/components/editorial/CanonicalArticleWizard.jsx')

  assert.match(canonical, /source_image_url: formData\.image_url \|\| sourceImageUrl \|\| ''/)
  assert.match(canonical, /uploadedSourceFileRef\.current\.file === selectedFile/)
  assert.match(canonical, /uploadedSourceFileRef\.current = \{ file: selectedFile, url: uploadedUrl \}/)
  assert.match(canonical, /const productionImageUrl = await resolveProductionImageUrl\(sourceImageRef\.current\)/)
  assert.match(canonical, /applyPreparedArticle\(saved, \{ preserveImage: true \}\)/)
})

test('self review remains tenant-scoped and exact-generation approval remains P0 guarded', async () => {
  const migration = await source('supabase/migrations/20260920153000_editorial_self_review.sql')

  assert.match(migration, /public\.require_single_operational_cliente_id\(\)/)
  assert.match(migration, /responsible_user_id IS DISTINCT FROM v_user_id/)
  assert.match(migration, /ap\.require_editorial_admin_access\(v_cliente_id\)/)
  assert.match(migration, /p_expected_revision_number IS DISTINCT FROM v_current_revision_number/)
  assert.match(migration, /c\.criado_por_user_id IS DISTINCT FROM v_user_id/)
  assert.match(migration, /c\.current_generation_id IS DISTINCT FROM p_generation_id/)
  assert.match(migration, /asset_url = p_asset_url AND asset_url = c\.render_url/)
  assert.doesNotMatch(migration, /INSERT INTO ap\.candidate_news|ap-render-engine|instagram/i)
})

test('canonical dispatch schedules one targeted render and never a batch or cron', async () => {
  const dispatch = await source('supabase/functions/ap-editorial-render-dispatch/index.ts')

  assert.match(dispatch, /JSON\.stringify\(\{ newsId: candidateId \}\)/)
  assert.match(dispatch, /"x-ap-internal-secret": internalSecret/)
  assert.match(dispatch, /AP_INTERNAL_WORKER_SECRET/)
  assert.match(dispatch, /EdgeRuntime\.waitUntil\(task\)/)
  assert.doesNotMatch(dispatch, /JSON\.stringify\(\{\s*\}\)|ap-render-recovery|cron\.schedule/)
})

test('rendered work remains visible to its creator and follows the shared operational tabs', async () => {
  const [admin, staff] = await Promise.all([
    source('src/pages/admin/AutoPublisher.jsx'),
    source('src/pages/admin/EmployeeMode.jsx'),
  ])

  assert.match(admin, /pending_render: 'em_producao'/)
  assert.match(admin, /pending_review: 'aprovadas'/)
  assert.match(admin, /approved: 'aprovadas'/)
  assert.doesNotMatch(admin, /currentTab === 'revisao'/)
  assert.match(staff, /\.schema\('ap'\)[\s\S]+\.from\('candidate_news'\)[\s\S]+\.eq\('criado_por_user_id', user\?\.id\)/)
  assert.match(staff, /p0_approve_generation/)
  assert.match(staff, /p_generation_id: item\.current_generation_id/)
  assert.match(staff, /p_asset_url: item\.render_url/)
})
