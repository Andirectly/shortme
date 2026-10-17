import { RenderPipelineBuilder, SrtTranscriber } from '@tscaps/engine'
const { ipcRenderer } = require('electron'); const fs = require('fs'), path = require('path')
const log = (m) => ipcRenderer.send('log', m);
(async () => {
try {
  const dir = path.join(process.env.SPIKE_DIR, '')
  const video = new Blob([fs.readFileSync(path.join(dir, 'out', 'clip60.mp4'))], { type: 'video/mp4' })
  const srt = fs.readFileSync(path.join(dir, 'subs', 'clip.srt'), 'utf8')
  const css = `.segment{font-family:system-ui;font-weight:900;font-size:4.2cqh;color:#fff;-webkit-text-stroke:.06em #000;paint-order:stroke fill;text-shadow:0 .1em .3em rgba(0,0,0,.6);text-align:center;line-height:1.15;text-transform:uppercase}.line{display:block;text-align:center}.word{display:inline-block;margin:0 .15em}.word.word-being-narrated{color:#ffd400}`
  log('start'); window.addEventListener('unhandledrejection',e=>log('UNHANDLED '+(e.reason&&e.reason.stack||e.reason))); const t0 = performance.now()
  const p = new RenderPipelineBuilder().withInputVideo(video).withTranscriber(new SrtTranscriber(srt)).withCss(css)
    .withAlignment({ verticalAlign: 'center', verticalOffset: 0.68, horizontalAlign: 'center', horizontalOffset: 0.5 }).withOutputResolution(1080, 1920).build()
  log('built pipeline'); const { blob } = await p.run((pr) => { const now = performance.now(); if (!globalThis.__l || now - globalThis.__l > 5000) { globalThis.__l = now; log("progress " + JSON.stringify(pr).slice(0, 160)) } })
  const sec = (performance.now() - t0) / 1000
  await ipcRenderer.invoke('save', await blob.arrayBuffer())
  log(`SUBS engine=@tscaps/engine export=${sec.toFixed(1)}s for 60s clip => ${(sec / 60).toFixed(2)}x realtime, bytes=${blob.size}`)
} catch (e) { log('SUBS ERROR ' + (e && e.stack || e)) }
ipcRenderer.send('done')
})()
