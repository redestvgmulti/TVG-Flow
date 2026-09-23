import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import test from 'node:test'

const source = await readFile(new URL('../public/push-sw.js', import.meta.url), 'utf8')

test('push worker activation only claims clients and leaves update navigation to the app', async () => {
  const listeners = new Map()
  let claims = 0
  const self = {
    addEventListener: (type, listener) => listeners.set(type, listener),
    clients: { claim: async () => { claims += 1 } },
  }
  runInNewContext(source, { self, console, URL })

  let activation
  listeners.get('activate')({ waitUntil: promise => { activation = promise } })
  await activation

  assert.equal(claims, 1)
  assert.equal(listeners.has('message'), false)
})
