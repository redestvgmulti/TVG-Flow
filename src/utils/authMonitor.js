/**
 * Auth Event Monitor
 * 
 * Lightweight monitoring system for authentication events.
 * Production-safe: logs only critical events, no PII.
 */

const AUTH_EVENTS = {
    SESSION_RECOVERED: 'session_recovered',
    SESSION_FAILED: 'session_failed',
    SIGNED_IN: 'signed_in',
    SIGNED_OUT: 'signed_out',
    TOKEN_REFRESHED: 'token_refreshed',
    TOKEN_REFRESH_FAILED: 'token_refresh_failed',
    BOOT_TO_AUTH: 'boot_to_authenticated',
    BOOT_TO_UNAUTH: 'boot_to_unauthenticated'
}

class AuthMonitor {
    constructor() {
        this.events = []
        this.maxEvents = 50 // Keep last 50 events
    }

    /**
     * Log an authentication event
     * @param {string} eventType - Type of auth event
     * @param {Object} metadata - Additional non-PII metadata
     */
    logEvent(eventType, metadata = {}) {
        const event = {
            type: eventType,
            timestamp: new Date().toISOString(),
            metadata: {
                ...metadata,
                // Never log PII (email, user ID, tokens)
                userAgent: navigator.userAgent.substring(0, 50),
                online: navigator.onLine
            }
        }

        this.events.push(event)

        // Keep only last N events
        if (this.events.length > this.maxEvents) {
            this.events.shift()
        }

        // Log to console in development only
        if (import.meta.env.DEV) {
            // console.log(`[AuthMonitor] ${eventType}`, metadata)
        }

        // In production, you could send critical events to your monitoring service
        // Example: if (eventType === AUTH_EVENTS.TOKEN_REFRESH_FAILED) { sendToSentry(...) }
    }

    /**
     * Get recent auth events
     * @param {number} limit - Number of events to return
     */
    getRecentEvents(limit = 10) {
        return this.events.slice(-limit)
    }

    /**
     * Get events by type
     * @param {string} eventType - Type of event to filter
     */
    getEventsByType(eventType) {
        return this.events.filter(e => e.type === eventType)
    }

    /**
     * Clear all events
     */
    clear() {
        this.events = []
    }

    /**
     * Get summary statistics
     */
    getSummary() {
        const summary = {}
        this.events.forEach(event => {
            summary[event.type] = (summary[event.type] || 0) + 1
        })
        return summary
    }
}

// Singleton instance
export const authMonitor = new AuthMonitor()
export { AUTH_EVENTS }
