import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { applyPlatformDocumentClasses } from './services/platform'
import App from './App.tsx'

applyPlatformDocumentClasses()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
