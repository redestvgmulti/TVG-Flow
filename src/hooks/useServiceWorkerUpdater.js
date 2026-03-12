/**
 * useServiceWorkerUpdater
 * 
 * Monitors for Service Worker controller changes.
 * When a new SW takes control (via skipWaiting), it marks the update as ready in sessionStorage.
 */
export function useServiceWorkerUpdater() {
    if (!('serviceWorker' in navigator)) return

    let refreshing = false
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        // Prevent multiple reloads from triggered events
        if (refreshing) return
        refreshing = true

        // Mark update as pending to be applied when safe
        sessionStorage.setItem('app_update_ready', 'true')
    })
}
