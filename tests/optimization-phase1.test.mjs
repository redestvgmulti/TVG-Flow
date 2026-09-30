import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('Header refreshes task status by events, visibility, and a bounded fallback', async () => {
  const header = await source('src/layout/Header.jsx')

  assert.match(header, /OPERATIONAL_STATUS_FALLBACK_MS = 15 \* 60_000/)
  assert.doesNotMatch(header, /setInterval\(refreshOperationalStatus, 60_000\)/)
  assert.match(header, /addEventListener\('focus', refreshWhenVisible\)/)
  assert.match(header, /addEventListener\('visibilitychange', refreshWhenVisible\)/)
  assert.match(header, /table: 'tarefas'.*refreshWhenVisible/)
  assert.match(header, /supabase\.removeChannel\(channel\)/)
})

test('backlog replaces the 15-second loop with a visible-tab fallback', async () => {
  const backlog = await source('src/components/editorial/NewsBacklogPanel.jsx')

  assert.match(backlog, /BACKLOG_FALLBACK_REFRESH_MS = 5 \* 60_000/)
  assert.doesNotMatch(backlog, /POLL_INTERVAL_MS|15_000/)
  assert.match(backlog, /addEventListener\('focus', refresh\)/)
  assert.match(backlog, /addEventListener\('visibilitychange', refresh\)/)
})

test('global Realtime channels are explicitly removed on cleanup', async () => {
  const header = await source('src/layout/Header.jsx')
  const sidebar = await source('src/layout/Sidebar.jsx')

  assert.match(header, /supabase\.removeChannel\(channel\)/)
  assert.match(sidebar, /supabase\.removeChannel\(taskSubscription\)/)
  assert.match(sidebar, /supabase\.removeChannel\(meetingSubscription\)/)
})

test('empty scheduled render batches do not write worker telemetry', async () => {
  const render = await source('supabase/functions/ap-render-engine/index.ts')
  const selection = render.indexOf('const { data: items, error: selectionError } = await query;')
  const noItems = render.indexOf('if (!items?.length)')
  const workTelemetry = render.indexOf('await startTelemetry();', noItems + 1)

  assert.ok(selection >= 0 && noItems > selection)
  assert.match(render, /if \(targetId\) \{\s*await startTelemetry\(\)/)
  assert.ok(workTelemetry > noItems)
})
