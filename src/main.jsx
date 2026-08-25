import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary'
import { hardenConsole, disableReactDevTools } from './utils/consoleGuard'

import './styles/reset.css'
import './styles/tokens.css'
import './styles/base.css'
import './styles/layout.css'
import './styles/components.css'
import './styles/utilities.css'
import './styles/reload-prompt.css'
import './styles/mobile-fixes.css'
import './styles/mobile-layout-fixes.css' // ÚLTIMO - sobrescreve tudo

async function clearStaleDevelopmentServiceWorker() {
  if (!import.meta.env.DEV || !('serviceWorker' in navigator)) return

  const registrations = await navigator.serviceWorker.getRegistrations()
  if (!registrations.length) return

  await Promise.all(registrations.map((registration) => registration.unregister()))

  if ('caches' in window) {
    const cacheNames = await caches.keys()
    await Promise.all(cacheNames.map((cacheName) => caches.delete(cacheName)))
  }

  // A prior PWA session can control localhost and serve an obsolete bundle.
  // Reload once after releasing it so the Vite modules are used from now on.
  window.location.reload()
}

void clearStaleDevelopmentServiceWorker()

// Apply security hardening BEFORE React renders
hardenConsole()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
)
