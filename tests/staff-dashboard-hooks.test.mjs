import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const source = await readFile(
  new URL('../src/pages/staff/Dashboard.jsx', import.meta.url),
  'utf8',
)

test('staff dashboard declares effects before auth loading can return', () => {
  const effectIndex = source.indexOf('useEffect(() =>')
  const loadingGuardIndex = source.indexOf('if (authLoading || !authReady || !professionalId)')

  assert.ok(effectIndex >= 0)
  assert.ok(loadingGuardIndex > effectIndex)
  assert.doesNotMatch(source.slice(0, effectIndex), /return <LoadingScreen/)
})
