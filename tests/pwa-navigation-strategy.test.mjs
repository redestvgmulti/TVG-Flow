import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const config = await readFile(new URL('../vite.config.js', import.meta.url), 'utf8')

test('online app navigation fetches the current HTML before using an offline copy', () => {
  assert.match(config, /navigateFallback: null/)
  assert.match(config, /request\.mode === 'navigate'/)
  assert.match(config, /handler: 'NetworkFirst',[\s\S]*?cacheName: 'app-navigation'/)
  assert.match(config, /precacheFallback: \{ fallbackURL: '\/index\.html' \}/)
})
