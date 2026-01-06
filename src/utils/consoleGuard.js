/**
 * Console Hardening for Production
 * Prevents sensitive data leakage through console logs
 */
export function hardenConsole() {
    if (import.meta.env.PROD) {
        const noop = () => { }

        // Disable all console methods except error
        console.log = noop
        console.warn = noop
        console.info = noop
        console.debug = noop
        console.trace = noop
        console.table = noop
        console.group = noop
        console.groupEnd = noop
        console.groupCollapsed = noop

        // Preserve error channel for future observability (Sentry, LogRocket, etc.)
        // Errors are NOT logged to browser console but channel remains intact
        const originalError = console.error
        console.error = (...args) => {
            // Intentionally left minimal.
            // Future: Forward sanitized errors to monitoring service here
            // For now, error channel is preserved but silent in browser
        }
    }
}

/**
 * Disable React DevTools in Production
 */
export function disableReactDevTools() {
    if (import.meta.env.PROD) {
        if (typeof window.__REACT_DEVTOOLS_GLOBAL_HOOK__ === 'object') {
            for (const key in window.__REACT_DEVTOOLS_GLOBAL_HOOK__) {
                window.__REACT_DEVTOOLS_GLOBAL_HOOK__[key] =
                    typeof window.__REACT_DEVTOOLS_GLOBAL_HOOK__[key] === 'function'
                        ? () => { }
                        : null
            }
        }
    }
}
