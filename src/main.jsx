import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import BrainNetwork from '../brain_network_2'

// LocalStorage shim for window.storage API used by the app
window.storage = {
  get: async (k) => ({ value: localStorage.getItem(k) }),
  set: async (k, v) => { localStorage.setItem(k, v) },
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrainNetwork />
  </StrictMode>
)
