import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../../', import.meta.url)
const migration = await readFile(
  new URL('supabase/migrations/20260927153000_fix_meeting_reminder_result_type.sql', root),
  'utf8',
)

test('meeting reminder RPC returns an integer minutes_until_start value', () => {
  assert.match(migration, /RETURNS TABLE\([\s\S]*?minutes_until_start integer[\s\S]*?notification_interval integer[\s\S]*?\)/)
  assert.match(
    migration,
    /FLOOR\(EXTRACT\(EPOCH FROM \(r\.data_inicio - NOW\(\)\)\) \/ 60\)::integer AS minutes_until_start/,
  )
  assert.doesNotMatch(
    migration,
    /EXTRACT\(EPOCH FROM \(r\.data_inicio - NOW\(\)\)\) \/ 60 AS minutes_until_start/,
  )
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.get_upcoming_meeting_notifications\(interval_minutes integer\)/)
  assert.match(
    migration,
    /SECURITY DEFINER\s+SET search_path TO 'pg_catalog', 'public', 'ap', 'extensions'/,
  )
})
