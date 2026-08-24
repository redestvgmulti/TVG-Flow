import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const source = await readFile(
  new URL('../src/components/UpdateBanner.jsx', import.meta.url),
  'utf8',
)

test('UpdateBanner binds every framer-motion namespace used by the update path', () => {
  const framerImport = source.match(
    /import\s*{([^}]*)}\s*from\s*['"]framer-motion['"]/,
  )

  assert.ok(framerImport, 'UpdateBanner must import from framer-motion')

  const importedNames = framerImport[1]
    .split(',')
    .map(name => name.trim())
    .filter(Boolean)

  assert.match(source, /<Motion\.div\b/, 'the available-update branch must render Motion.div')
  assert.ok(
    importedNames.includes('motion as Motion'),
    'Motion must be bound before the available-update branch renders Motion.div',
  )
  assert.ok(
    importedNames.includes('AnimatePresence'),
    'AnimatePresence must remain imported for the update banner transition',
  )
})
