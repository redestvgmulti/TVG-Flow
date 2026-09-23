export function activatePwaUpdate(updateServiceWorker, serviceWorker, timeoutMs = 12000) {
    return new Promise(resolve => {
        if (!serviceWorker) {
            resolve({ status: 'error', error: new Error('SERVICE_WORKER_UNAVAILABLE') })
            return
        }

        let settled = false
        let timeoutId
        const finish = result => {
            if (settled) return
            settled = true
            clearTimeout(timeoutId)
            serviceWorker.removeEventListener('controllerchange', onControllerChange)
            resolve(result)
        }
        const onControllerChange = () => finish({ status: 'activated' })

        serviceWorker.addEventListener('controllerchange', onControllerChange)
        timeoutId = setTimeout(() => finish({ status: 'timeout' }), timeoutMs)
        Promise.resolve()
            .then(() => updateServiceWorker(true))
            .catch(error => finish({ status: 'error', error }))
    })
}
