import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const fetcherUrl = new URL('../supabase/functions/ap-image-fetcher/index.ts', import.meta.url)

test('image fetcher lock uses the observed value as a PostgREST compare-and-set', async () => {
  const source = await readFile(fetcherUrl, 'utf8')

  assert.match(source, /const observedLock = typeof item\.processing_started_at === "string"/)
  assert.match(source, /lockQuery\.is\("processing_started_at", null\)/)
  assert.match(source, /lockQuery\.eq\("processing_started_at", observedLock\)/)
  assert.doesNotMatch(
    source,
    /\.update\(\{ processing_started_at: lockTime \}\)[\s\S]{0,300}\.or\(/,
  )
  assert.match(source, /\.eq\("processing_started_at", lockTime\)/)
})
