import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('reports show one readable collaborator view without client switching', async () => {
  const reports = await source('src/pages/admin/Reports.jsx')
  const styles = await source('src/styles/adminReports.css')

  assert.match(reports, /get_staff_productivity_report/)
  assert.match(reports, /Acompanhamento da equipe/)
  assert.match(reports, /Por colaborador/)
  assert.match(reports, /Trabalho agora/)
  assert.match(reports, /Entregas no período/)
  assert.match(reports, /Produção recente/)
  assert.match(reports, /reports-summary/)
  assert.match(reports, /reports-staff-grid/)
  assert.doesNotMatch(reports, /get_client_stats|ClientsTable|Por Cliente|activeTab/)
  assert.match(styles, /\.reports-staff-grid \{[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/)
  assert.match(styles, /@media \(max-width: 768px\) \{[\s\S]*\.reports-staff-grid \{[\s\S]*grid-template-columns: 1fr/)
})
