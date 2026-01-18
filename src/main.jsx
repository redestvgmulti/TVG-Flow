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

// Apply security hardening BEFORE React renders
hardenConsole()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
)
