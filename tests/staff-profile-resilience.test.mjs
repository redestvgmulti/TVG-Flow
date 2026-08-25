import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('profile fallback is restricted to unavailable self-service database features', async () => {
  const service = await readFile(new URL('../src/services/profileService.js', import.meta.url), 'utf8')
  assert.match(service, /code === 'PGRST202'/)
  assert.match(service, /code === 'PGRST205'/)
  assert.match(service, /if \(!isMissingProfileSelfServiceFeature\(error\)\) throw error/)
  assert.match(service, /supabase\.rpc\('get_current_identity'\)/)
  assert.match(service, /self_service_available: false/)
  assert.doesNotMatch(service, /isMissingProfileSelfServiceFeature\(error\)\) return \{ \.\.\.DEFAULT_NOTIFICATION_PREFS \}/)
})

test('optional profile cards cannot hide an otherwise valid profile', async () => {
  const page = await readFile(new URL('../src/pages/staff/Profile.jsx', import.meta.url), 'utf8')
  assert.match(page, /const profileData = await getMyProfile\(\)/)
  assert.match(page, /Promise\.allSettled/)
  assert.match(page, /setProfile\(profileData\)/)
  assert.match(page, /getMyMonthProductivity\(profileData\.id\)/)
  assert.match(page, /Tentar novamente/)
})

test('legacy database mode stays readable without pretending profile writes succeeded', async () => {
  const service = await readFile(new URL('../src/services/profileService.js', import.meta.url), 'utf8')
  const page = await readFile(new URL('../src/pages/staff/Profile.jsx', import.meta.url), 'utf8')

  assert.match(service, /PROFILE_SELF_SERVICE_UNAVAILABLE/)
  assert.match(service, /if \(isMissingProfileSelfServiceFeature\(error\)\) throw profileFeatureUnavailableError\(\)/)
  assert.match(service, /if \(isMissingProfileSelfServiceFeature\(error\)\) return null/)
  assert.match(page, /const selfServiceAvailable = profile\?\.self_service_available !== false/)
  assert.match(page, /disabled=\{!selfServiceAvailable\}/)
})

test('profile migration scopes writes to the authenticated user and refreshes PostgREST', async () => {
  const migration = await readFile(new URL('../supabase/migrations/20260824150000_staff_profile_self_service.sql', import.meta.url), 'utf8')

  assert.match(migration, /WHERE id = auth\.uid\(\)/)
  assert.match(migration, /profissional_id = auth\.uid\(\)/)
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.update_my_profile\(text, text\) FROM PUBLIC, anon/)
  assert.match(migration, /NOTIFY pgrst, 'reload schema'/)
})

test('pending migration chain preserves the deployed backlog event contract', async () => {
  const titleMigration = await readFile(new URL('../supabase/migrations/20260824110000_add_news_backlog_title_editing.sql', import.meta.url), 'utf8')

  assert.match(titleMigration, /'linked'/)
  await assert.rejects(
    readFile(new URL('../supabase/migrations/20260823190000_add_discard_news_backlog_item.sql', import.meta.url), 'utf8'),
    error => error?.code === 'ENOENT'
  )
})

test('productivity includes every open task status used by the current schema', async () => {
  const service = await readFile(new URL('../src/services/profileService.js', import.meta.url), 'utf8')

  assert.match(service, /'pendente', 'em_progresso', 'em_execucao', 'atrasada'/)
})
