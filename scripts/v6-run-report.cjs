// Kompakte Auswertung eines Laufs: node scripts/v6-run-report.cjs <projektHash> [runId|engine]  (Engine 6 und Engine 4)
const fs = require('fs'), p = require('path')
const [hash, which] = process.argv.slice(2)
const base = p.join(process.env.SHORTME_DATA || p.join(process.env.APPDATA, 'cutawan'), 'projects', hash, 'analysis')
const st = JSON.parse(fs.readFileSync(p.join(base, 'state.json'), 'utf8'))
const runs = st.runs.filter((r) => !which || r.runId === which || r.engineId === which)
const run = runs[runs.length - 1]
if (!run) throw new Error('kein Lauf')
const dir = p.join(base, 'runs', run.runId)
const rd = (n) => { try { return JSON.parse(fs.readFileSync(p.join(dir, n), 'utf8')) } catch { return null } }
const clips = rd('clips.json') ?? (() => { try { return JSON.parse(fs.readFileSync(p.join(base, 'runs', run.runId, 'clips.json'), 'utf8')) } catch { return null } })()
const out = { run: run.runId, engine: run.engineId, status: run.status, clips: run.clipCount }
const m = rd('manifest.json')
if (m?.profile) Object.assign(out, { wallSec: m.profile.wallSec, firstVerifiedSec: m.profile.firstVerifiedSec, peakVramMb: m.profile.peakVramUsedMb, peakRssMb: m.profile.peakRssMb, counters: m.profile.counters, phases: m.profile.phases.map((x) => `${x.name} ${x.sec}`).join(' · '), errors: m.errors.length })
else if (m) out.stageSec = m.stageSec
const sel = rd('selection.json')
if (sel) out.selection = { wanted: sel.wanted, delivered: sel.delivered ?? sel.chosen?.length, verified: sel.verified ?? sel.finalists?.filter((f) => f.decision === 'acceptable').length, shortfall: sel.shortfall }
const au = rd('audits.json')
if (au) out.audits = au.filter((a) => a.chosen).map((a) => `${a.attemptId.split('-').pop()} ${a.audit?.status} pak ${a.audit?.coverage.observedSec}/${a.audit?.coverage.outputSec}s ${(a.audit?.criteria ?? []).filter((c) => c.state !== 'pass').map((c) => c.id + ':' + c.state).join(',')}`)
try { out.skipped = fs.readFileSync(p.join(dir, 'v6-selection.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).skipped).reduce((a, s) => { const k = String(s).slice(0, 60); a[k] = (a[k] ?? 0) + 1; return a }, {}) } catch { /* Engine 4 */ }
console.log(JSON.stringify(out, null, 1))
