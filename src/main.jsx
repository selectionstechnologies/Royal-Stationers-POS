import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import { installFormValidation } from './lib/formValidation'
import { installNumericInput } from './lib/numericInput'
import './index.css'

installFormValidation()
installNumericInput()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
