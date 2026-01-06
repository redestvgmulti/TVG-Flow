export function hardenConsole() {
    if (import.meta.env.PROD) {
        const noop = () => { }
        console.log = noop
        console.warn = noop
        console.info = noop
        console.debug = noop
        console.error = noop
    }
}

export function disableReactDevTools() {
    if (import.meta.env.PROD && window.__REACT_DEVTOOLS_GLOBAL_HOOK__) {
        for (const key in window.__REACT_DEVTOOLS_GLOBAL_HOOK__) {
            window.__REACT_DEVTOOLS_GLOBAL_HOOK__[key] =
                typeof window.__REACT_DEVTOOLS_GLOBAL_HOOK__[key] === 'function'
                    ? () => { }
                    : null
        }
    }
}
