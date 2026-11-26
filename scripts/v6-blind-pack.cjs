// Anonymes Vergleichspaket für die menschliche Blindbewertung: node scripts/v6-blind-pack.cjs <projektHash> <runIdA> <runIdB> <zielordner>
// Kopiert die fertigen Clips beider Läufe unter Zufallsnamen (z. B. 07.mp4) und schreibt key.json (Zuordnung) getrennt. Bewertungsbogen: bewertung.csv
const fs = require('fs'), p = require('path'), crypto = require('crypto')
const [hash, a, b, out] = process.argv.slice(2)
if (!out) throw new Error('Aufruf: v6-blind-pack.cjs <hash> <runA> <runB> <ziel>')
const base = p.join(process.env.SHORTME_DATA || p.join(process.env.APPDATA, 'cutawan'), 'projects', hash, 'analysis', 'runs')
const walk = (d) => fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(p.join(d, e.name)) : [p.join(d, e.name)]) : []
function clipsOf(run) {
  const dir = p.join(base, run)
  const sel = JSON.parse(fs.readFileSync(p.join(dir, 'selection.json'), 'utf8'))
  if (sel.chosen?.[0]?.artifact) return sel.chosen.map((c) => ({ clip: c.clipId, file: c.artifact.path, status: c.status }))
  return sel.chosen.map((c) => ({ clip: c.clipId, file: c.output, status: (sel.finalists.find((f) => f.id === c.fromFinalist) ?? {}).decision }))
}
const items = [...clipsOf(a).map((x) => ({ ...x, run: a })), ...clipsOf(b).map((x) => ({ ...x, run: b }))].filter((x) => fs.existsSync(x.file))
const order = items.map((x) => ({ x, r: crypto.randomBytes(4).readUInt32LE() })).sort((u, v) => u.r - v.r).map((o) => o.x)
fs.mkdirSync(out, { recursive: true })
const key = {}
let csv = 'Nr;Urteil (direkt veröffentlichen / leichte Korrektur / größere Korrektur / ungeeignet);Nacharbeit (Minuten);Notiz\n'
order.forEach((x, i) => { const n = String(i + 1).padStart(2, '0'); fs.copyFileSync(x.file, p.join(out, `${n}.mp4`)); key[n] = { run: x.run, clip: x.clip, status: x.status }; csv += `${n};;;\n` })
fs.writeFileSync(p.join(out, 'bewertung.csv'), '﻿' + csv)
fs.writeFileSync(p.join(out, '..', p.basename(out) + '-KEY-nicht-ansehen.json'), JSON.stringify(key, null, 1))
console.log(`${order.length} Clips in ${out}; Schlüssel daneben`)
