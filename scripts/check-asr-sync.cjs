// Prüft, ob Wortzeiten des Transkripts zum Ton passen: node scripts/check-asr-sync.cjs [projektHash …]
// Je 3-Minuten-Abschnitt: Kreuzkorrelation zwischen „Wort aktiv“ (aus transcript.json) und Lautstärke (aus audio.wav) über ±4 s → bester Versatz in Sekunden.
// Versatz ≈ 0 = synchron; konstanter Versatz = Zeitnullpunkt falsch; wachsender Versatz = Drift.
const fs = require('fs'), p = require('path')
const { spawnSync } = require('child_process')
const ff = require('ffmpeg-static')
const root = p.join(process.env.SHORTME_DATA || p.join(process.env.APPDATA, 'cutawan'), 'projects')
const HOP = 0.02, SEG = 180, MAXLAG = 4
const hashes = process.argv.length > 2 ? process.argv.slice(2) : fs.readdirSync(root)
for (const h of hashes) {
  const dir = p.join(root, h)
  let t, meta
  try { t = JSON.parse(fs.readFileSync(p.join(dir, 'transcript.json'), 'utf8')); meta = JSON.parse(fs.readFileSync(p.join(dir, 'project.json'), 'utf8')) } catch { continue }
  if (!t.words?.length || !fs.existsSync(p.join(dir, 'audio.wav'))) continue
  const r = spawnSync(ff, ['-v', 'error', '-i', p.join(dir, 'audio.wav'), '-f', 's16le', '-ac', '1', '-ar', '16000', '-'], { maxBuffer: 1 << 30 })
  const buf = r.stdout, n = buf.length / 2, per = 16000 * HOP
  const frames = Math.floor(n / per), e = new Float64Array(frames)
  for (let i = 0; i < frames; i++) { let s = 0; for (let k = 0; k < per; k++) { const v = buf.readInt16LE((i * per + k) * 2) / 32768; s += v * v } e[i] = Math.sqrt(s / per) }
  const act = new Float64Array(frames)
  for (const w of t.words) for (let i = Math.floor(w.start / HOP); i < Math.min(frames, Math.ceil(w.end / HOP)); i++) if (i >= 0) act[i] = 1
  const out = []
  for (let s0 = 0; s0 + SEG <= frames * HOP + 1; s0 += SEG) {
    const a = Math.floor(s0 / HOP), b = Math.min(frames, Math.floor((s0 + SEG) / HOP)), L = Math.round(MAXLAG / HOP)
    if (b - a < 600 || t.words.filter((w) => w.start >= s0 && w.start < s0 + SEG).length < 30) continue
    const z = (arr) => { const m = arr.reduce((x, y) => x + y, 0) / arr.length; const sd = Math.sqrt(arr.reduce((x, y) => x + (y - m) ** 2, 0) / arr.length) || 1; return arr.map((y) => (y - m) / sd) }
    const E = z(Array.from(e.slice(a, b)))
    let best = -1e9, bl = 0
    for (let lag = -L; lag <= L; lag++) {
      let c = 0
      for (let i = 0; i < b - a; i++) { const j = a + i - lag; if (j >= 0 && j < frames) c += E[i] * (act[j] - 0.5) }
      if (c > best) { best = c; bl = lag }
    }
    out.push(`${Math.round(s0 / 60)}m:${(bl * HOP).toFixed(2)}s`)
  }
  console.log(h.slice(0, 8), (meta.title || '').slice(0, 28).padEnd(28), Math.round(meta.durationSec / 60) + 'min', '| Versatz je 3 min (Ton liegt gegenüber dem Text um … später):', out.join('  '))
}
