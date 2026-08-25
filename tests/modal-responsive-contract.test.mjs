import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../', import.meta.url)
const source = path => readFile(new URL(path, root), 'utf8')

test('shared modal shell constrains the viewport and delegates scrolling to its body', async () => {
  const styles = await source('src/styles/components.css')

  assert.match(styles, /\.modal-backdrop\s*\{[^}]*height:\s*100dvh;[^}]*overflow:\s*hidden;/s)
  assert.match(styles, /\.modal\s*\{[^}]*max-height:\s*calc\(100dvh - 32px\);[^}]*display:\s*flex;[^}]*flex-direction:\s*column;[^}]*overflow:\s*hidden;/s)
  assert.match(styles, /\.modal-body\s*\{[^}]*flex:\s*1 1 auto;[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto;/s)
  assert.match(styles, /\.modal > form\s*\{[^}]*flex:\s*1 1 auto;[^}]*min-height:\s*0;[^}]*overflow:\s*hidden;/s)
  assert.match(styles, /@media \(max-width:\s*640px\)[\s\S]*max-height:\s*calc\(100dvh[^;]+safe-area-inset-bottom/s)
})

test('page styles cannot globally disable or resize unrelated modals', async () => {
  const [tasks, macroTask, meetings, companies, content] = await Promise.all([
    source('src/styles/adminTasks.css'),
    source('src/styles/macro-task.css'),
    source('src/styles/meetings.css'),
    source('src/styles/companies.css'),
    source('src/styles/content.css'),
  ])

  assert.doesNotMatch(tasks, /^\s*\.modal\.modal-large\s*\{/m)
  assert.doesNotMatch(tasks, /^\s*\.modal-backdrop\s*\{/m)
  assert.doesNotMatch(macroTask, /^\s*\.modal\.modal-large\s*\{/m)
  assert.doesNotMatch(macroTask, /^\s*\.modal-backdrop\s*\{/m)
  assert.doesNotMatch(meetings, /^\s*\.modal\s*\{/m)
  assert.doesNotMatch(meetings, /^\s*\.modal-(?:header|body|footer|content)\s*\{/m)
  assert.doesNotMatch(companies, /^\s*\.modal\s*\{/m)
  assert.doesNotMatch(companies, /^\s*\.modal-(?:header|body|footer)\s*\{/m)
  assert.doesNotMatch(content, /^\s*\.modal-(?:body|footer)\s*\{/m)
})

test('task and meeting large modals opt into scoped responsive contracts', async () => {
  const [workflow, workflowStyles, adminTasks, meetings, staffMeetings] = await Promise.all([
    source('src/components/ConversaoWorkflowModal.jsx'),
    source('src/styles/conversao-workflow-modal.css'),
    source('src/pages/admin/Tasks.jsx'),
    source('src/pages/admin/Meetings.jsx'),
    source('src/pages/staff/Meetings.jsx'),
  ])

  assert.match(workflow, /className="workflow-conversion-modal"/)
  assert.match(workflowStyles, /\.workflow-conversion-modal \.modal-body/)
  assert.match(adminTasks, /className="modal-backdrop task-detail-modal-backdrop"/)
  assert.match(adminTasks, /className="modal modal-large task-detail-admin-modal"/)
  assert.match(meetings, /className="modal meeting-modal"/)
  assert.match(staffMeetings, /className="modal meeting-modal"/)
})

test('custom modal implementations also cap their height to the dynamic viewport', async () => {
  const [summary, autoPublisher, tenant] = await Promise.all([
    source('src/components/dashboard/TaskSummaryModal.jsx'),
    source('src/styles/AutoPublisher.css'),
    source('src/pages/super-admin/TenantDetail.jsx'),
  ])

  assert.match(summary, /\.task-summary-modal\s*\{[^}]*max-height:\s*calc\(100dvh - 32px\);[^}]*overflow-y:\s*auto;/s)
  assert.match(autoPublisher, /\.ap-modal-content\s*\{[^}]*max-height:\s*calc\(100dvh - 40px\);[^}]*min-height:\s*0;/s)
  assert.match(autoPublisher, /\.ap-modal-body\s*\{[^}]*overflow-y:\s*auto;[^}]*flex:\s*1 1 auto;[^}]*min-height:\s*0;/s)
  assert.match(tenant, /maxHeight:\s*'calc\(100dvh - 32px\)'[^\n]*overflowY:\s*'auto'/)
})
