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

// Apply security hardening BEFORE React renders
// hardenConsole() // TEMPORARILY DISABLED FOR DEBUGGING

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
)
