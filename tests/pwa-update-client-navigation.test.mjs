import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import test from 'node:test'

const source = await readFile(new URL('../public/push-sw.js', import.meta.url), 'utf8')

function workerHarness() {
  const listeners = new Map()
  const navigations = []
  const client = {
    id: 'requesting-tab',
    url: 'https://tvgflow.vercel.app/staff/materias',
    navigate: async url => { navigations.push(url) },
  }
  const self = {
    location: { origin: 'https://tvgflow.vercel.app' },
    addEventListener: (type, listener) => listeners.set(type, listener),
    clients: {
      claim: async () => {},
      get: async id => id === client.id ? client : null,
    },
  }
  runInNewContext(source, { self, console, URL, setTimeout: callback => callback() })
  return { listeners, navigations }
}

async function activate(listeners) {
  let activation
  listeners.get('activate')({ waitUntil: promise => { activation = promise } })
  await activation
}

test('ordinary service worker activation leaves open tabs in place', async () => {
  const { listeners, navigations } = workerHarness()
  await activate(listeners)
  assert.deepEqual(navigations, [])
})

test('a tab requesting an update is navigated after activation even if its old bundle misses controllerchange', async () => {
  const { listeners, navigations } = workerHarness()
  listeners.get('message')({ data: { type: 'SKIP_WAITING' }, source: { id: 'requesting-tab' } })
  await activate(listeners)
  assert.deepEqual(navigations, ['https://tvgflow.vercel.app/staff/materias'])
})
