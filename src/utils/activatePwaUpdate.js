// The PWA plugin reloads the page when the waiting worker takes control.
// If that event never arrives, release this registration and fetch the app
// again instead of leaving the update button stuck.
export function activatePwaUpdate(updateServiceWorker, serviceWorker, reload = () => window.location.reload(), timeoutMs = 5000) {
    const originalController = serviceWorker?.controller
    let recovering = false
    let timeoutId

    const recover = async () => {
        if (recovering) return
        recovering = true
        clearTimeout(timeoutId)

        try {
            // A changed controller means activation succeeded but the plugin
            // missed its reload. Otherwise, remove the stalled registration.
            if (serviceWorker?.controller === originalController) {
                const registration = await serviceWorker?.getRegistration()
                await registration?.unregister()
            }
        } catch (error) {
            console.error('[PWA] Could not release stalled worker:', error)
        } finally {
            reload()
        }
    }

    timeoutId = setTimeout(() => { void recover() }, timeoutMs)
    Promise.resolve()
        .then(() => updateServiceWorker(true))
        .catch(error => {
            console.error('[PWA] Could not activate new worker:', error)
            void recover()
        })
}
