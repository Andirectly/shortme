import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import ShortmeApp from './shortme/ShortmeApp'
import './index.css'

// Shortme-Oberfläche (M1-Prototyp). `?legacy` startet die alte Cutawan-Oberfläche.
const Root = new URLSearchParams(location.search).has('legacy') ? App : ShortmeApp

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
)
