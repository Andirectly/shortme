// Nur die Oberfläche im Browser (ohne Electron, Demo-Daten) – für Layout-Prüfungen: npx vite --config vite.preview.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'
import pkg from './package.json'

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  define: { __BUILD__: JSON.stringify(`v${pkg.version} · Vorschau`), __VERSION__: JSON.stringify(pkg.version) },
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@shared': resolve(__dirname, 'src/shared'), '@': resolve(__dirname, 'src/renderer/src') } },
  server: { port: 5174, strictPort: true }
})
