// Qualitätsmessung gegen echte Creator-Schnitte (V4-050/052, maschineller Teil).
// Maßstab: Stellen, die der Creator selbst als Short veröffentlicht hat (Werkbank: Tonabgleich Short ↔ Langvideo, creator.json).
// Akzeptanzband (VOR der Messung festgelegt, nicht nachträglich verschieben): Start in [Start − 5 s, Start + 2 s], Ende in [Ende − 2 s, Ende + 5 s], Peak = Mitte.
// Je Engine zählt der neueste fertige Volllauf (keine Rechecks). Auswertung mit dem Paketwerkzeug tools/v4_eval.py, dazu Bootstrap-Vertrauensbereiche über Quellen.
//   node scripts/quality-eval.mjs <python.exe> [k=10]
// Schreibt docs/quality/gold.json, pred.json, eval.json, report.md. Medien bleiben außerhalb des Repos.
import { createHash } from 'node:crypto'
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

const [py, kArg] = process.argv.slice(2)
if (!py) { console.error('Aufruf: node scripts/quality-eval.mjs <python.exe> [k]'); process.exit(2) }
const K = Number(kArg ?? 10)
const DATA = process.env.SHORTME_DATA ?? join(process.env.APPDATA ?? '', 'cutawan')
const PROJ = join(DATA, 'projects')
const OUT = 'docs/quality'
const BAND = { startBefore: 5, startAfter: 2, endBefore: 2, endAfter: 5 }
const ENGINE_OF = { legacy: 'engine1', 'multimodal-v2': 'engine2', 'adaptive-v3': 'engine3', engine4: 'engine4' }
const read = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')) } catch { return null } }
const sha256File = (f) => new Promise((res, rej) => { const h = createHash('sha256'); createReadStream(f).on('data', (d) => h.update(d)).on('end', () => res(h.digest('hex'))).on('error', rej) })

/** Quell-SHA: aus dem Engine-4-Probe-Cache, sonst aus der Datei, sonst unbekannt (Quelle wird dann ausgelassen). */
async function sourceSha(hash, meta) {
  const c = read(join(PROJ, hash, 'analysis', 'shared', 'source-v4.json'))
  if (c?.sha256) return c.sha256
  if (meta?.sourcePath && existsSync(meta.sourcePath)) return sha256File(meta.sourcePath)
  return null
}

/** Neuester fertiger Volllauf je Engine → Clips (Rang = Reihenfolge nach Score wie in der App). */
function runsOf(hash) {
  const st = read(join(PROJ, hash, 'analysis', 'state.json'))
  const out = {}
  for (const r of [...(st?.runs ?? [])].reverse()) {
    const e = ENGINE_OF[r.engineId]
    if (!e || out[e] || !['done', 'incomplete'].includes(r.status)) continue
    const f = read(join(PROJ, hash, 'analysis', 'runs', r.runId, 'clips.json'))
    if (f?.clips?.length) out[e] = { runId: r.runId, clips: f.clips }
  }
  const legacy = read(join(PROJ, hash, 'clips.json'))
  if (!out.engine1 && legacy?.clips?.length && (!legacy.engine || legacy.engine === 'legacy')) out.engine1 = { runId: 'legacy', clips: legacy.clips }
  return out
}

/** Bootstrap über Quellen (1000 Ziehungen, fester Seed) → 95-%-Bereich der Mikro-Trefferquote. */
function bootstrap(rows, B = 1000) {
  if (!rows.length) return null
  let s = 7
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648)
  const vals = []
  for (let b = 0; b < B; b++) {
    let g = 0, m = 0
    for (let i = 0; i < rows.length; i++) { const r = rows[Math.floor(rnd() * rows.length)]; g += r.goldEvents; m += r.matchedEvents }
    if (g) vals.push(m / g)
  }
  vals.sort((a, b) => a - b)
  return [vals[Math.floor(0.025 * vals.length)], vals[Math.floor(0.975 * vals.length)]]
}

const gold = { sources: [] }, pred = { clips: [] }, inventory = []
for (const hash of existsSync(PROJ) ? readdirSync(PROJ) : []) {
  const creator = read(join(PROJ, hash, 'creator.json'))
  if (!creator?.shorts?.length) continue
  const meta = read(join(PROJ, hash, 'project.json'))
  const sha = await sourceSha(hash, meta)
  const runs = runsOf(hash)
  inventory.push({ hash, title: meta?.title ?? hash, durationSec: Math.round(meta?.durationSec ?? 0), shorts: creator.shorts.length, sha: sha ?? null, engines: Object.fromEntries(Object.entries(runs).map(([e, r]) => [e, `${r.runId} (${r.clips.length})`])) })
  if (!sha) continue
  const events = creator.shorts.flatMap((s) => s.moments.map((m, i) => ({ id: `${s.id}-${i + 1}`, start: m.start, end: m.end, peak: (m.start + m.end) / 2, allowedStart: [m.start - BAND.startBefore, m.start + BAND.startAfter], allowedEnd: [m.end - BAND.endBefore, m.end + BAND.endAfter] })))
  gold.sources.push({ sha256: sha, creator: creator.channel, session: meta?.title ?? hash, events })
  for (const [engineId, r] of Object.entries(runs)) {
    const ranked = [...r.clips].sort((a, b) => b.score - a.score)
    ranked.forEach((c, i) => pred.clips.push({ engineId, sourceSha256: sha, runKind: 'full-source-analysis', eventId: c.id, start: c.start, end: c.end, rank: i + 1 }))
  }
}
mkdirSync(OUT, { recursive: true })
writeFileSync(join(OUT, 'gold.json'), JSON.stringify(gold, null, 1))
writeFileSync(join(OUT, 'pred.json'), JSON.stringify(pred, null, 1))
if (!gold.sources.length) { console.error('Keine Quelle mit Creator-Shorts und bekannter SHA'); process.exit(1) }
const res = JSON.parse(execFileSync(py, ['-I', '-X', 'utf8', 'docs/implementation/shortme-engine-v4/tools/v4_eval.py', '--gold', join(OUT, 'gold.json'), '--pred', join(OUT, 'pred.json'), '--k', String(K)], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } }))
for (const e of Object.keys(res.results)) {
  const r = res.results[e]
  const rows = r.perSource.filter((x) => x.predictedClips > 0)
  r.sourcesWithRun = rows.length
  r.recallCI95 = bootstrap(rows)
  const sub = rows.reduce((a, x) => ({ g: a.g + x.goldEvents, m: a.m + x.matchedEvents }), { g: 0, m: 0 })
  r.recallOnSourcesWithRun = sub.g ? sub.m / sub.g : null
}
res.band = BAND
res.inventory = inventory
writeFileSync(join(OUT, 'eval.json'), JSON.stringify(res, null, 1))
const pct = (x) => (x == null ? '–' : `${Math.round(x * 100)} %`)
const lines = [
  `# Qualitätsmessung gegen Creator-Schnitte (k = ${K})`, '',
  `Maßstab: ${gold.sources.length} Videos, ${gold.sources.reduce((n, s) => n + s.events.length, 0)} vom Creator veröffentlichte Short-Stellen. Akzeptanzband: Start −${BAND.startBefore}/+${BAND.startAfter} s, Ende −${BAND.endBefore}/+${BAND.endAfter} s.`,
  'Nur Läufe auf Quellen, die die Engine wirklich analysiert hat, zählen in „Treffer (mit Lauf)“. Zeitliche Treffer sind KEINE menschliche Bewertung der Clip-Qualität.', '',
  '| Engine | Videos mit Lauf | Treffer (mit Lauf) | 95-%-Bereich | Start+Ende im Band (der Treffer) |', '|---|---|---|---|---|',
  ...Object.entries(res.results).map(([e, r]) => `| ${e} | ${r.sourcesWithRun} | ${pct(r.recallOnSourcesWithRun)} | ${r.recallCI95 ? `${pct(r.recallCI95[0])}–${pct(r.recallCI95[1])}` : '–'} | ${pct(r.bothBoundaryAtMatched)} |`),
  '', '## Videos', '| Video | Länge | Shorts | Läufe |', '|---|---|---|---|',
  ...inventory.map((i) => `| ${i.title.slice(0, 60)} | ${Math.round(i.durationSec / 60)} min | ${i.shorts} | ${Object.entries(i.engines).map(([e, r]) => `${e}: ${r}`).join(', ') || '–'}${i.sha ? '' : ' (SHA fehlt)'} |`)
]
writeFileSync(join(OUT, 'report.md'), lines.join('\n') + '\n')
console.log(lines.slice(4, 11).join('\n'))
