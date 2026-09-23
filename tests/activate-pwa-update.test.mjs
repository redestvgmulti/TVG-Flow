import assert from 'node:assert/strict'
import test from 'node:test'
import { activatePwaUpdate } from '../src/utils/activatePwaUpdate.js'

test('a stalled update releases its registration and reloads', async () => {
  let unregisters = 0
  let updates = 0
  const serviceWorker = {
    controller: {},
    getRegistration: async () => ({ unregister: async () => { unregisters += 1 } }),
  }
  await new Promise(resolve => {
    activatePwaUpdate(() => { updates += 1 }, serviceWorker, resolve, 5)
  })
  assert.equal(updates, 1)
  assert.equal(unregisters, 1)
})

test('a changed controller reloads without unregistering the new worker', async () => {
  let unregisters = 0
  const serviceWorker = {
    controller: {},
    getRegistration: async () => ({ unregister: async () => { unregisters += 1 } }),
  }
  await new Promise(resolve => {
    activatePwaUpdate(() => { serviceWorker.controller = {} }, serviceWorker, resolve, 5)
  })
  assert.equal(unregisters, 0)
})

test('an activation error immediately falls back to a reload', async () => {
  let unregisters = 0
  const serviceWorker = {
    controller: {},
    getRegistration: async () => ({ unregister: async () => { unregisters += 1 } }),
  }
  await new Promise(resolve => {
    activatePwaUpdate(() => { throw new Error('worker unavailable') }, serviceWorker, resolve, 1000)
  })
  assert.equal(unregisters, 1)
})
