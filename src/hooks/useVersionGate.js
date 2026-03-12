import { useEffect } from 'react'
import { forceUpgrade } from '../utils/forceUpgrade'

/**
 * Semver comparison utility (Simplified)
 * Handles "1.2.3" vs "1.2.4"
 */
function isOutdated(current, target) {
    if (!target) return false
    
    // Remove hash part if present: "1.0.1+abc" -> "1.0.1"
    const curr = current.split('+')[0].split('.').map(Number)
    const min = target.split('.').map(Number)

    for (let i = 0; i < 3; i++) {
        if (curr[i] < min[i]) return true
        if (curr[i] > min[i]) return false
    }
    return false
}

/**
 * useVersionGate
 * 
 * Checks for global version requirements from system-version.json.
 * Triggers forceUpgrade if local version is below min_version.
 */
export function useVersionGate() {
    const checkVersionGate = async () => {
        try {
            const response = await fetch('/system-version.json?t=' + Date.now(), {
                cache: 'no-store',
                headers: { 'Cache-Control': 'no-cache' }
            })

            if (!response.ok) return

            const data = await response.json()
            const currentVersion = __APP_VERSION__

            // Critical check: Is a force update required?
            if (data.force_update && isOutdated(currentVersion, data.min_version)) {
                console.warn('[VersionGate] Local version is outdated. Forcing upgrade...')
                await forceUpgrade()
            }
        } catch (error) {
            console.error('[VersionGate] FAILED:', error)
        }
    }

    useEffect(() => {
        // Initial check
        checkVersionGate()

        // Periodic check every 5 minutes
        const interval = setInterval(checkVersionGate, 5 * 60 * 1000)

        return () => clearInterval(interval)
    }, [])
}
