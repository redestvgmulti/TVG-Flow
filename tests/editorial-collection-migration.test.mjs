import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const migration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260827172413_editorial_collection_work_and_productivity.sql'),
  'utf8',
)

test('editorial collection migration retains only valid professional attribution during production backfill', () => {
  assert.match(
    migration,
    /FROM ap\.candidate_news AS candidate\s+JOIN public\.profissionais AS creator\s+ON creator\.id = candidate\.criado_por_user_id/,
  )
  assert.match(
    migration,
    /IF NEW\.criado_por_user_id IS NOT NULL\s+AND EXISTS \(\s+SELECT 1\s+FROM public\.profissionais AS professional\s+WHERE professional\.id = NEW\.criado_por_user_id/,
  )
})
