/**
 * forceUpgrade
 * 
 * Forcefully upgrades the application by:
 * 1. Unregistering all Service Workers
 * 2. Clearing all Cache Storage
 * 3. Clearing LocalStorage and SessionStorage
 * 4. Hard reloading the page
 */
export async function forceUpgrade() {
    console.warn('[VersionGate] Executing force upgrade...')
    
    try {
        // 1. Unregister Service Workers
        if ('serviceWorker' in navigator) {
            const registrations = await navigator.serviceWorker.getRegistrations()
            for (const registration of registrations) {
                await registration.unregister()
            }
        }

        // 2. Clear Caches
        if ('caches' in window) {
            const keys = await caches.keys()
            await Promise.all(keys.map(key => caches.delete(key)))
        }

        // 3. Clear Storages (Nuclear option)
        localStorage.clear()
        sessionStorage.clear()

        // 4. Force Reload
        window.location.reload()
    } catch (error) {
        console.error('[VersionGate] Force upgrade failed:', error)
        window.location.reload()
    }
}
