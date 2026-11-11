import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'
import { execSync } from 'node:child_process'
import pkg from './package.json'

// Versionsanzeige unten links: Version + Commit + Datum des Builds
const commit = (() => { try { return execSync('git rev-parse --short HEAD').toString().trim() } catch { return 'dev' } })()
const BUILD = JSON.stringify(`v${pkg.version} · ${commit} · ${new Date().toLocaleDateString('de-DE')}`)

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          inferenceWorker: resolve(__dirname, 'src/main/inference/worker.ts'),
          asrWorker: resolve(__dirname, 'src/main/engines/asr/worker.ts')
        }
      }
    },
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared')
      }
    }
  },
  renderer: {
    define: { __BUILD__: BUILD, __VERSION__: JSON.stringify(pkg.version) },
    plugins: [react(), tailwindcss()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/renderer/index.html'), captions: resolve(__dirname, 'src/renderer/captions.html'), title: resolve(__dirname, 'src/renderer/title.html') }
      }
    },
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
        '@': resolve(__dirname, 'src/renderer/src')
      }
    }
  }
})
