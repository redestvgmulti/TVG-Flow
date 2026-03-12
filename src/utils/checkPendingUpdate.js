/**
 * checkPendingUpdate
 * 
 * Checks if there's a pending update in sessionStorage.
 * If found, clears the flag and reloads the application.
 */
export function checkPendingUpdate() {
    const pending = sessionStorage.getItem('app_update_ready')

    if (pending === 'true') {
        sessionStorage.removeItem('app_update_ready')
        window.location.reload()
    }
}
