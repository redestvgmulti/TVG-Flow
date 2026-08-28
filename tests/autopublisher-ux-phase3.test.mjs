import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('matter navigation uses operational labels and keeps team outside status tabs', async () => {
  const ui = await source('src/pages/admin/AutoPublisher.jsx')
  const navigation = await source('src/config/navigation.js')
  const sidebar = await source('src/layout/Sidebar.jsx')
  const styles = await source('src/styles/AutoPublisher.css')

  for (const label of ['Novas matérias', 'Para produzir', 'Produzindo', 'Para revisar', 'Prontas', 'Publicadas']) {
    assert.match(ui, new RegExp(`label: '${label}'`))
  }
  assert.doesNotMatch(ui, /\{ key: 'operacao', label:/)
  assert.match(navigation, /label: 'Matérias', path: '\/admin\/autopublisher'/)
  assert.match(navigation, /label: 'Equipe', path: '\/admin\/autopublisher\/operacao'/)
  assert.doesNotMatch(navigation, /key: 'ap-templates'/)
  assert.match(sidebar, /const \[adminPanelOpen, setAdminPanelOpen\] = useState\(false\)/)
  assert.match(sidebar, /openNavGroups\[item\.key\] \?\? false/)
  assert.match(styles, /\.ap-my-work-sections \{[\s\S]*background: var\(--color-bg-surface, #fff\)/)
  assert.match(styles, /\.ap-my-work-section-empty \{[\s\S]*border: 1px dashed/)
})

test('pending queue and its counter use the same non-final status sets', async () => {
  const ui = await source('src/pages/admin/AutoPublisher.jsx')

  assert.match(ui, /const PENDING_AVAILABLE_STATUSES = \['raw', 'ready_for_scoring', 'scored', 'selected', 'studio_selected', 'studio_ready'\]/)
  assert.match(ui, /const PENDING_ERROR_STATUSES = \['failed'\]/)
  assert.match(ui, /if \(currentTab === 'pendentes'\) \{[\s\S]*return PENDING_AVAILABLE_STATUSES/)
  assert.match(ui, /key === 'pendentes' \? currentPendingCount/)
  assert.match(ui, /\.order\('updated_at', \{ ascending: currentTab === 'revisao' \}\)/)
  assert.match(ui, /Entrou para revisão: \{formatOperationalDate\(item\.updated_at\)\}/)
  assert.doesNotMatch(ui, /PENDING_AVAILABLE_STATUSES[^\n]*rejected/)
  assert.doesNotMatch(ui, /PENDING_ERROR_STATUSES[^\n]*rejected/)
})

test('presentation labels remain separate from stored statuses and workflow RPCs', async () => {
  const ui = await source('src/pages/admin/AutoPublisher.jsx')
  const backlog = await source('src/components/editorial/NewsBacklogPanel.jsx')
  const collected = await source('src/components/editorial/CollectedNewsPanel.jsx')
  const approvalModal = await source('src/components/editorial/ApproveCollectedNewsModal.jsx')
  const team = await source('src/components/editorial/TeamNewsWorkPanel.jsx')
  const approvalObservationMigration = await source('supabase/migrations/20260828183000_add_collected_news_approval_observation.sql')

  assert.match(ui, /pending_render: \{ label: 'Preparando'/)
  assert.match(ui, /processing: \{ label: 'Gerando arte'/)
  assert.match(ui, /pending_review: \{ label: 'Para revisar'/)
  assert.match(ui, /approved: \{ label: 'Pronta'/)
  assert.match(ui, /failed: \{ label: 'Erro'/)
  assert.match(backlog, /adopt_news_backlog_item/)
  assert.match(backlog, /Pegar matéria/)
  assert.match(collected, /approve_collected_news/)
  assert.match(collected, /p_observacao: observation/)
  assert.match(collected, /ApproveCollectedNewsModal/)
  assert.doesNotMatch(collected, /window\.prompt\('Observação para quem pegar esta pauta/)
  assert.match(approvalModal, /title="Aprovar pauta"/)
  assert.match(approvalModal, /Aprovar e enviar ao banco/)
  assert.match(approvalModal, /Orientação para quem for produzir/)
  assert.match(approvalModal, /Essa orientação aparecerá junto da matéria no Banco de pautas/)
  assert.match(collected, /Novas matérias encontradas/)
  assert.match(team, /admin_release_news_backlog_item/)
  assert.match(team, /approved_from_collection: 'Disponibilizada no Banco de pautas'/)
  assert.match(team, /candidate_created: 'Produção criada'/)
  assert.match(team, /render_completed: 'Arte gerada'/)
  assert.match(team, /function timelineEventLabel\(action\)/)
  assert.match(team, /timelineEventLabel\(event\.action\)/)
  assert.doesNotMatch(team, /event\.action\.replaceAll/)
  assert.match(team, /<h2>Equipe<\/h2>/)
  assert.match(approvalObservationMigration, /CREATE OR REPLACE FUNCTION ap\.approve_collected_news\([\s\S]*p_observacao text/)
  assert.match(approvalObservationMigration, /COALESCE\(v_observacao, NULLIF\(v_collected\.excerpt, ''\)\)/)
  assert.match(approvalObservationMigration, /GRANT EXECUTE ON FUNCTION ap\.approve_collected_news\(uuid, uuid, text\) TO authenticated/)
  assert.doesNotMatch(approvalObservationMigration, /\bDELETE\s+FROM\b|\bTRUNCATE\b|DROP TABLE/i)
})

test('editorial actions use shared modals instead of native browser dialogs', async () => {
  const collected = await source('src/components/editorial/CollectedNewsPanel.jsx')
  const team = await source('src/components/editorial/TeamNewsWorkPanel.jsx')
  const reasonModal = await source('src/components/editorial/EditorialReasonModal.jsx')
  const companies = await source('src/pages/admin/Companies.jsx')

  for (const component of [collected, team, companies]) {
    assert.doesNotMatch(component, /window\.(prompt|confirm|alert)/)
  }
  assert.match(collected, /title="Descartar matéria"/)
  assert.match(team, /title="Liberar para o Banco de pautas"/)
  assert.match(reasonModal, /import Modal from '\.\.\/ui\/Modal'/)
  assert.match(companies, /title="Desativar empresa"/)
})
