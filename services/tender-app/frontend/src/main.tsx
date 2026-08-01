import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import ConfigPage from './ConfigPage'

const basename = (import.meta.env.BASE_URL || "/").replace(/\/$/, "")
const pathname = window.location.pathname
const routePath = basename && pathname.startsWith(basename)
  ? pathname.slice(basename.length) || "/"
  : pathname
const page = routePath === "/config" ? <ConfigPage /> : <App />

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {page}
  </StrictMode>,
)
