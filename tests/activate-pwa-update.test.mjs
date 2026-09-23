import assert from 'node:assert/strict'
import test from 'node:test'
import { activatePwaUpdate } from '../src/utils/activatePwaUpdate.js'

test('update completes only after the service worker takes control', async () => {
    const serviceWorker = new EventTarget()
    const result = activatePwaUpdate(() => {
        queueMicrotask(() => serviceWorker.dispatchEvent(new Event('controllerchange')))
    }, serviceWorker, 100)

    assert.deepEqual(await result, { status: 'activated' })
})

test('update releases the page if the service worker never activates', async () => {
    const serviceWorker = new EventTarget()
    assert.deepEqual(
        await activatePwaUpdate(() => Promise.resolve(), serviceWorker, 10),
        { status: 'timeout' },
    )
})

test('update reports a failed activation request', async () => {
    const error = new Error('registration failed')
    const result = await activatePwaUpdate(() => Promise.reject(error), new EventTarget(), 100)
    assert.equal(result.status, 'error')
    assert.equal(result.error, error)
})
