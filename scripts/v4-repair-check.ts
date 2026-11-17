/**
 * Engine 4 – echter Reparatur-Nachweis (V4-035, S6-Abnahme): Ein angenommener Clip eines echten V4-Laufs wird absichtlich VOR der Pointe beendet,
 * gerendert und am fertigen Clip mit MiniCPM-o geprüft. Erwartet: Fehler erkannt → eine begründete Reparatur (späteres Ende auf gemessener Kante)
 * → neu gerendert (neue SHA) → neu geprüft. Exit 0 nur, wenn alle drei Schritte wirklich eintreten; sonst Exit 1 mit Grund.
 *   SHORTME_DATA=<Daten> npx tsx --tsconfig tsconfig.node.json scripts/v4-repair-check.ts <projekt-hash> <runId>
 */
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { killAllSidecars } from '../src/main/engines/sidecars'
import { loadMeta, projectFile } from '../src/main/shortme/project'
import { loadTranscript } from '../src/main/shortme/transcription'
import { ensureSignals } from '../src/main/shortme/clips/analysis'
import { runDir } from '../src/main/shortme/clips/engines/state'
import { withAv } from '../src/main/shortme/clips/engines/v3/avWorker'
import { clipFor, judgeRendered, measuredCriteria, planRepair, renderVariant } from '../src/main/shortme/clips/engines/v4/finalize'
import { firstRepairable, type CutCandidate, type CutEdge } from '../src/main/shortme/clips/engines/v4/core'
import { Tracer } from '../src/main/shortme/clips/engines/v4/trace'

async function main(): Promise<number> {
  const [hash, runId] = process.argv.slice(2)
  const meta = await loadMeta(hash), t = await loadTranscript(hash)
  if (!meta || !t) throw new Error('Projekt/Transkript fehlt')
  const dir = runDir(hash, runId)
  const edges = (JSON.parse(await readFile(join(dir, 'cut_edges.json'), 'utf8')) as { edges: CutEdge[] }).edges
  const rounds = JSON.parse(await readFile(join(dir, 'verdicts.json'), 'utf8')) as Array<{ variantId: string; judgement: { decision: string } | null }>
  const variants = JSON.parse(await readFile(join(dir, 'variants.json'), 'utf8')) as Array<{ id: string; cut: CutCandidate }>
  const ok = rounds.find((r) => r.judgement?.decision === 'acceptable')
  const v = variants.find((x) => x.id === ok?.variantId)
  if (!v) { console.log('FAIL: kein angenommener Clip im Lauf'); return 1 }
  const s0 = edges.find((e) => e.id === v.cut.startEdgeId)!
  // absichtlich zu früh beenden: späteste Kante, die mindestens 35 % vor dem echten Ende liegt (Pointe/Reaktion fehlt)
  const cutAt = v.cut.span.end - (v.cut.span.end - v.cut.span.start) * 0.35
  const e1 = [...edges].filter((e) => e.t > s0.t + 8 && e.t <= cutAt && ['sentence', 'pause', 'shot', 'audio-phrase', 'action'].includes(e.kind)).sort((a, b) => b.t - a.t)[0]
  if (!e1) { console.log('FAIL: keine frühere Kante zum Abschneiden'); return 1 }
  const trunc: CutCandidate = { id: `${s0.id}__${e1.id}`, startEdgeId: s0.id, endEdgeId: e1.id, span: { start: s0.t, end: e1.t }, prefilter: 0 }
  const signals = await ensureSignals(meta)
  const out = join(dir, 'repair-check')
  const tracer = new Tracer(out, `${runId}-repaircheck`, 'repair-check')
  const wav = projectFile(hash, 'audio.wav')
  const report: Record<string, unknown> = { runId, variant: v.id, original: v.cut, truncated: trunc }
  const code = await withAv(`${runId}-rc`, async (s) => {
    const r0 = await renderVariant(meta, t, signals, [], clipFor('rc-trunc', trunc, t, [], { title: 'Reparaturprobe' }), join(out, 'r0'))
    const j0 = await judgeRendered(s, r0, { variantId: 'rc-trunc', summary: 'Clip, dessen Ende absichtlich vor der Pointe liegt', wav, hasAudio: meta.hasAudio !== false, edges, tracer, round: 0 })
    report.round0 = { sha256: r0.sha256, durationSeconds: r0.durationSeconds, decision: j0.judgement?.decision, criteria: j0.judgement?.criteria.map((c) => `${c.id}:${c.state}`), error: j0.error }
    if (!j0.judgement) { report.result = 'Endprüfung ungültig'; return 1 }
    const failure = firstRepairable(j0.judgement.criteria)
    report.detected = failure
    if (!failure) { report.result = 'abgeschnittene Pointe NICHT erkannt'; return 1 }
    const sil = (await measuredCriteria(r0, wav, meta.hasAudio !== false, edges)).silences
    const plan = planRepair(failure, trunc, edges, r0, sil, { minSec: 8, maxSec: 75 })
    report.repair = plan ? { op: plan.op, reason: plan.reason, to: plan.cut } : null
    if (!plan) { report.result = 'keine begründete Reparatur gefunden'; return 1 }
    const r1 = await renderVariant(meta, t, signals, [], clipFor('rc-fixed', plan.cut, t, plan.trims, { title: 'Reparaturprobe' }), join(out, 'r1'))
    const j1 = await judgeRendered(s, r1, { variantId: 'rc-fixed', summary: 'reparierter Clip', wav, hasAudio: meta.hasAudio !== false, edges, tracer, round: 1 })
    report.round1 = { sha256: r1.sha256, durationSeconds: r1.durationSeconds, decision: j1.judgement?.decision, criteria: j1.judgement?.criteria.map((c) => `${c.id}:${c.state}`), error: j1.error }
    const changed = r1.sha256 !== r0.sha256 && plan.cut.span.end > trunc.span.end
    report.result = changed && j1.judgement ? 'erkannt, repariert, neu gerendert, neu geprüft' : 'Reparatur nicht vollständig'
    return changed && j1.judgement ? 0 : 1
  })
  await writeFile(join(out, 'report.json'), JSON.stringify(report, null, 1))
  console.log(JSON.stringify(report, null, 1))
  console.log(code === 0 ? 'PASS' : 'FAIL')
  return code
}

main().then(async (c) => { await killAllSidecars(); process.exit(c) }).catch(async (e) => { console.error('FEHLER', e); await killAllSidecars(); process.exit(1) })
