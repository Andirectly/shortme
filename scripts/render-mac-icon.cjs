// Rendert build/icon-mac.svg → build/icon-mac.png (1024², transparent) mit Electron. Aufruf: npx electron scripts/render-mac-icon.cjs
const { app, BrowserWindow } = require('electron')
const fs = require('fs')
const path = require('path')
app.whenReady().then(async () => {
  const svg = fs.readFileSync(path.join(__dirname, '..', 'build', 'icon-mac.svg'), 'utf8')
  const w = new BrowserWindow({ width: 1024, height: 1024, show: false, transparent: true, frame: false, webPreferences: { offscreen: true, zoomFactor: 1 } })
  await w.loadURL('data:text/html,' + encodeURIComponent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`))
  await new Promise((r) => setTimeout(r, 300))
  const img = (await w.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 })).resize({ width: 1024, height: 1024, quality: 'best' })
  fs.writeFileSync(path.join(__dirname, '..', 'build', 'icon-mac.png'), img.toPNG())
  console.log('ok', img.getSize())
  app.quit()
})
