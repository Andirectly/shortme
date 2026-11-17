/**
 * Engine 4 – prüft einen ECHTEN Lauf (aus docs/ENGINE_V4_RUN_PROOF.json) gegen die Real-Media-Anforderungen. Liest nur Lauf-Dateien; jede Prüfung
 * ist eine harte Bedingung an tatsächlich erzeugte Daten (keine Modell-Selbstauskunft). Exit 0 nur, wenn alle angefragten Prüfungen bestehen.
 *   npx tsx --tsconfig tsconfig.node.json scripts/v4-e2e-verify.ts [V4-014 …]
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const proof = JSON.parse(readFileSync('docs/ENGINE_V4_RUN_PROOF.json', 'utf8'))
const dir = dirname(proof.runManifestAbsolutePath)
const j = (n: string): any => JSON.parse(readFileSync(join(dir, n), 'utf8')) // eslint-disable-line @typescript-eslint/no-explicit-any
const calls: Array<Record<string, any>> = j('model_calls.json') // eslint-disable-line @typescript-eslint/no-explicit-any
const ok = (role: string, mods: string[]): Array<Record<string, any>> => calls.filter((c) => c.role === role && c.success && mods.every((m) => (c.realInputModalities ?? []).includes(m)) && existsSync(join(dir, c.tracePath))) // eslint-disable-line @typescript-eslint/no-explicit-any
const graphs = j('event_graphs.json'), cand = j('candidates.json'), cov = j('coverage.json'), verdicts = j('verdicts.json'), edges = j('cut_edges.json'), manifest = j('manifest.json')

/** Vergleichsnachweis: docs/ENGINE_V4_COMPARE_PROOF.json + die echte Vergleichsdatei im Projekt. */
function cmpCheck(fn: (c: any, f: any) => string | null): string | null { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!existsSync('docs/ENGINE_V4_COMPARE_PROOF.json')) return 'docs/ENGINE_V4_COMPARE_PROOF.json fehlt (scripts/v4-compare-proof.ts)'
  const c = JSON.parse(readFileSync('docs/ENGINE_V4_COMPARE_PROOF.json', 'utf8'))
  const p = join(dir, '..', '..', 'comparisons', `${c.comparisonId}.json`)
  if (!existsSync(p)) return 'Vergleichsdatei im Projekt fehlt'
  return fn(c, JSON.parse(readFileSync(p, 'utf8')))
}

const checks: Record<string, () => string | null> = {
  'V4-010': () => {
    if (!['speech', 'audio', 'visual'].every((l) => (cov.deciles[l] ?? []).length === 10 && cov.deciles[l].every(Boolean))) return `Zehntel nicht vollständig: ${JSON.stringify(cov.deciles)}`
    // zusätzlich eine echte Langquelle (≥ 1 h): docs/ENGINE_V4_LONG_RUN.json
    if (!existsSync('docs/ENGINE_V4_LONG_RUN.json')) return 'Langlauf (≥ 1 h) fehlt'
    const lr = JSON.parse(readFileSync('docs/ENGINE_V4_LONG_RUN.json', 'utf8'))
    const lm = JSON.parse(readFileSync(lr.runManifestAbsolutePath, 'utf8')), lc = JSON.parse(readFileSync(join(dirname(lr.runManifestAbsolutePath), 'coverage.json'), 'utf8'))
    return lm.engineId === 'engine4' && lm.source.durationSec >= 3600 && ['completed', 'partial'].includes(lm.status) && ['speech', 'audio', 'visual'].every((l) => lc.deciles[l]?.every(Boolean)) ? null : 'Langlauf unvollständig'
  },
  'V4-014': () => { const c = ok('video_embedding', ['video']); const q = ok('query_embedding', ['text']); return c.length && q.length && /qwen3-vl-embedding-2b@9f2f7e71/.test(c[0].modelRevision) ? null : 'kein erfolgreicher Qwen3-VL-Embedding-2B-Aufruf mit Videoeingabe' },
  'V4-015': () => (ok('av_verification', ['video', 'audio']).length ? null : 'keine AV-Prüfung mit Bild UND Ton'),
  'V4-018': () => { const s = cand.seeds.filter((x: any) => x.lane === 'audio'); return s.length && s.every((x: any) => x.evidenceIds.length) ? null : 'Audio-Lane ohne eigene Seeds/Belege' }, // eslint-disable-line @typescript-eslint/no-explicit-any
  'V4-019': () => { const g = cand.groups.filter((x: any) => !x.lanes.includes('speech') && x.lanes.some((l: string) => l === 'visual' || l === 'cross-modal')); return g.length ? null : 'keine Gruppe aus Bild-Lanes ohne Sprache' }, // eslint-disable-line @typescript-eslint/no-explicit-any
  'V4-023': () => { const two = graphs.filter((x: any) => x.secondWindow && x.calls >= 2); return two.length ? null : 'kein echter Zweitfenster-Aufruf' }, // eslint-disable-line @typescript-eslint/no-explicit-any
  'V4-025': () => {
    // Gaming-Quelle: docs/ENGINE_V4_GAMING_RUN.json – Gruppe ohne Sprach-Lane mit beobachteter Handlung/Reaktion
    if (!existsSync('docs/ENGINE_V4_GAMING_RUN.json')) return 'Gaming-Lauf fehlt'
    const gr = JSON.parse(readFileSync('docs/ENGINE_V4_GAMING_RUN.json', 'utf8')), gd = dirname(gr.runManifestAbsolutePath)
    const gc = JSON.parse(readFileSync(join(gd, 'candidates.json'), 'utf8')), gg = JSON.parse(readFileSync(join(gd, 'event_graphs.json'), 'utf8'))
    const noSpeech = new Set(gc.groups.filter((x: any) => !x.lanes.includes('speech')).map((x: any) => `eg-${x.id}`)) // eslint-disable-line @typescript-eslint/no-explicit-any
    if (!gg.some((x: any) => noSpeech.has(x.graph.id) && x.graph.nodes.some((n: any) => n.state === 'observed' && ['action', 'reaction', 'payoff', 'trigger'].includes(n.role)))) return 'kein wortloses Spielereignis mit beobachteter Handlung/Reaktion' // eslint-disable-line @typescript-eslint/no-explicit-any
    // und im Proof-Lauf: wortloses Ereignis mit beobachteten Rollen
    const ids = new Set(cand.groups.filter((x: any) => !x.lanes.includes('speech')).map((x: any) => `eg-${x.id}`)) // eslint-disable-line @typescript-eslint/no-explicit-any
    return graphs.some((x: any) => ids.has(x.graph.id) && x.graph.nodes.some((n: any) => n.state === 'observed')) ? null : 'kein wortloses Ereignis mit beobachteten Rollen' // eslint-disable-line @typescript-eslint/no-explicit-any
  },
  'V4-028': () => { const kinds = new Set(edges.edges.map((e: any) => e.kind)); return edges.edges.every((e: any) => e.isMeasured && e.evidenceIds.length) && kinds.size >= 4 ? null : `zu wenige gemessene Kantenarten: ${[...kinds].join(',')}` }, // eslint-disable-line @typescript-eslint/no-explicit-any
  'V4-033': () => (['video', 'audio'].every((s) => proof.outputProbe.streams.includes(s)) && proof.outputProbe.durationSeconds > 3 ? null : 'Ausgabe ohne Bild+Ton'),
  'V4-034': () => { const c = ok('rendered_output_judge', ['video', 'audio']).filter((x) => x.inputArtifactSha256 === proof.outputSha256); const v = verdicts.find((x: any) => x.judgement && x.rendered.sha256 === proof.outputSha256); return c.length && v && v.judgement.criteria.length === 10 ? null : 'Endprüfung bezieht sich nicht auf die ausgewählte Ausgabedatei' }, // eslint-disable-line @typescript-eslint/no-explicit-any
  'V4-035': () => { const p = join(dir, 'repair-check', 'report.json'); if (!existsSync(p)) return 'repair-check/report.json fehlt (scripts/v4-repair-check.ts)'; const r = JSON.parse(readFileSync(p, 'utf8')); return r.result === 'erkannt, repariert, neu gerendert, neu geprüft' ? null : `Reparaturprobe: ${r.result}` },
  'V4-040': () => cmpCheck((c, f) => (c.runIds.length === 4 && c.runIds.includes(proof.runId) && f.sourceMediaId === proof.runManifestAbsolutePath.split(/[\\/]/).slice(-5, -4)[0] ? null : 'Vergleich nicht über alle vier Engines derselben Quelle')),
  'V4-041': () => cmpCheck((c) => (c.recheck?.kind === 'clip-recheck' && c.recheck.status === 'done' && c.matchesUnchangedByRecheck === true && existsSync(join(dir, '..', '..', 'comparisons', `${c.comparisonId}.rechecks.json`)) ? null : 'Recheck nicht getrennt/nicht ausgeführt')),
  'V4-049': () => cmpCheck((_c, f) => { const eng = new Set(f.runIds.map((r: string) => r === 'legacy' ? 'legacy' : r.slice(0, 2))); return eng.size === 4 && f.kind === 'full-source-discovery' ? null : 'nicht vier getrennte Vollquellen-Läufe' }), // eslint-disable-line @typescript-eslint/no-explicit-any
  'V4-046': () => {
    // echter Lauf ohne Tonspur/Sprache: docs/ENGINE_V4_SILENT_RUN.json → silent-check.json des Laufs
    if (!existsSync('docs/ENGINE_V4_SILENT_RUN.json')) return 'tonloser Lauf fehlt (scripts/v4-silent-check.ts)'
    const sr = JSON.parse(readFileSync('docs/ENGINE_V4_SILENT_RUN.json', 'utf8'))
    const sc = JSON.parse(readFileSync(join(dirname(sr.runManifestAbsolutePath), 'silent-check.json'), 'utf8'))
    return sc.ok === true && sc.judgedOutputs > 0 && sc.audioSeamNotApplicable === true && !sc.sourceStreams.includes('audio') ? null : `tonloser Lauf nicht vollständig geprüft: ${JSON.stringify(sc).slice(0, 160)}`
  },
  'V4-048': () => (manifest.engineId === 'engine4' && ['completed', 'partial'].includes(manifest.status) && ok('asr', ['audio']).length && ok('audio_event', ['audio']).length && ok('local_cut_judge', ['video', 'audio']).length && proof.clipIds.length ? null : 'Kette Quelle→Lanes→Graph→Schnitt→Render→Prüfung unvollständig')
}

const want = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(checks)
let bad = 0
for (const id of want) {
  const f = checks[id]
  if (!f) { console.log(`${id} UNBEKANNT`); bad++; continue }
  let r: string | null
  try { r = f() } catch (e) { r = `Fehler: ${e instanceof Error ? e.message : e}` }
  console.log(`${id} ${r ? `FAIL – ${r}` : 'PASS'} (Lauf ${proof.runId})`)
  if (r) bad++
}
process.exit(bad ? 1 : 0)
