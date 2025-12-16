import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// import './assets/styles/theme.css'
// import './assets/styles/utilities.css'
// import './assets/styles/index.css'
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'

/* Controlled CSS Architecture */
import './styles/reset.css'
import './styles/tokens.css'
import './styles/base.css'
import './styles/layout.css'
import './styles/components.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
