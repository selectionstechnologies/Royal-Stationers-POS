import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { isConfigured } from './lib/supabase'
import { AuthProvider } from './auth/AuthProvider'
import App from './App.jsx'
import './index.css'

function ConfigMissing() {
  return (
    <div className="screen-center">
      <div className="card config-card">
        <h2>Supabase not configured</h2>
        <p className="text-secondary">
          Copy <code>.env.example</code> to <code>.env</code>, fill in your Supabase URL and publishable key, run <code>supabase/setup.sql</code> in the SQL Editor, then restart{' '}
          <code>npm run dev</code>.
        </p>
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {isConfigured ? (
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    ) : (
      <ConfigMissing />
    )}
  </StrictMode>,
)
