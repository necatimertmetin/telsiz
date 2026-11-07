import {createRoot} from 'react-dom/client'
import {App} from './ui/App'
import {setupTitlebar} from './lib/titlebar'
import './ui/styles.css'

setupTitlebar()
createRoot(document.getElementById('root')!).render(<App />)
if ('serviceWorker' in navigator && location.protocol === 'https:' && !window.Capacitor)
  navigator.serviceWorker.register('sw.js').catch(() => {})
