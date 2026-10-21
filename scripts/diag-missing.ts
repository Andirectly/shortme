/** Ursache fehlender Wörter im Parakeet-Transkript eingrenzen (Referenz: Qwen3-ASR als zweiter, unabhängiger Erkenner).
 *   SHORTME_DATA=<Daten> npx tsx --tsconfig tsconfig.node.json scripts/diag-missing.ts <video> [Sekunden=600]
 * Ursachen je Qwen-only-Wort: gleichzeitiges Sprechen (LR-ASD / Diarisierung), außerhalb der VAD-Segmente, am Rand eines ASR-Stücks,
 * mitten im Stück (Modell lässt aus). Dazu: Anteil, den die Lückensuche zurückholt, und Verlust in der Untertitel-Darstellung (VTT/ASS). */
import { join } from 'node:path'
import { diarizeWav } from '../src/main/engines/asr/client'
import { withAsr } from '../src/main/engines'
import { analyzeClipASD, ASD_FPS } from '../src/main/pipeline/asd'
import { importFile } from '../src/main/shortme/importer'
import { discardProject, loadMeta, projectFile } from '../src/main/shortme/project'
import { loadTranscript, readCheckpoint, runTranscription } from '../src/main/shortme/transcription'
import { qwenTextForRanges } from '../src/main/testlab/qwenAsr'
import { mergeQwenText } from '../src/shared/wordDiff'
import { BUILTIN_PRESETS } from '../src/shared/preset'
import { buildVtt, groupWords } from '../src/shared/captions'
import { buildAss } from '../src/main/shortme/render/ass'

type R = [number, number]
const inter = (a: R, b: R): number => Math.max(0, Math.min(a[1], b[1]) - Math.max(a[0], b[0]))

/** Zeiten, in denen mindestens zwei „Sprecher“ gleichzeitig aktiv sind (Intervalle ≥ 0,3 s). */
function simultaneous(spans: R[][]): R[] {
  const ev: Array<[number, number]> = []
  for (const list of spans) for (const [a, b] of list) { ev.push([a, 1], [b, -1]) }
  ev.sort((x, y) => x[0] - y[0] || x[1] - y[1])
  const out: R[] = []
  let n = 0, start = 0
  for (const [t, d] of ev) { const was = n; n += d; if (was < 2 && n >= 2) start = t; if (was >= 2 && n < 2 && t - start >= 0.3) out.push([start, t]) }
  return out
}

async function main(): Promise<void> {
  const [video, secArg = '600'] = process.argv.slice(2)
  const SEC = Number(secArg)
  const imp = await importFile(video)
  const hash = imp.meta.hash
  const meta = (await loadMeta(hash))!
  console.log(`Projekt ${hash.slice(0, 8)} · ${Math.round(meta.durationSec / 60)} min · untersucht: erste ${SEC} s`)
  await runTranscription(meta, {})
  const t = (await loadTranscript(hash))!
  const wav = projectFile(hash, 'audio.wav')

  // 1) Parakeet ohne Lückenfüllung (nur nicht-gefüllte Segmente) im Untersuchungsfenster
  const cp = await readCheckpoint(hash)
  const base = cp.filter((s) => !s.filled && s.start < SEC)
  const filled = cp.filter((s) => s.filled && s.start < SEC)
  const orig = base.flatMap((s) => s.words).filter((w) => w.start < SEC).sort((a, b) => a.start - b.start)
  const vad: R[] = base.map((s) => [s.start, s.end])
  console.log(`Parakeet: ${orig.length} Wörter in ${vad.length} Stücken; Lückenfüllung ergänzte ${filled.flatMap((s) => s.words).length} Wörter`)

  // 2) Qwen3-ASR als unabhängige Referenz
  const tokens = (await qwenTextForRanges(wav, [[0, SEC]]))[0]
  const m = mergeQwenText(orig, tokens, vad)
  const qwenOnly = m.inserts.flatMap((g) => g.words.map((w) => ({ ...w, before: g.before, group: g })))
  const del = orig.length - (orig.length - 0) // Platzhalter, Anzahl Parakeet-only siehe unten
  void del
  console.log(`Qwen3-ASR: ${tokens.length} Wörter · nur bei Qwen: ${qwenOnly.length} (Einfügungen) · andere Schreibweise: ${Object.keys(m.subs).length}`)

  // 3) gleichzeitiges Sprechen: LR-ASD und Diarisierung
  console.log('Gleichzeitiges Sprechen (LR-ASD, Diarisierung) …')
  const asd = await analyzeClipASD(meta.sourcePath, 0, SEC).catch(() => null)
  const asdSpans: R[][] = (asd?.tracks ?? []).map((tr) => {
    const out: R[] = []
    let s = -1
    tr.scores.forEach((v, i) => { const on = v > 0; const time = (tr.start + i) / ASD_FPS; if (on && s < 0) s = time; if ((!on || i === tr.scores.length - 1) && s >= 0) { out.push([s, time]); s = -1 } })
    return out
  })
  const overlapAsd = simultaneous(asdSpans)
  const turns = await withAsr(() => diarizeWav(wav))
  const bySpeaker = new Map<number, R[]>()
  for (const tn of turns) { const l = bySpeaker.get(tn.speaker) ?? []; l.push([tn.start, tn.end]); bySpeaker.set(tn.speaker, l) }
  const overlapDiar = simultaneous([...bySpeaker.values()])
  console.log(`Überlappung laut LR-ASD: ${overlapAsd.length} Stellen (${overlapAsd.reduce((n, [a, b]) => n + b - a, 0).toFixed(0)} s) · Diarisierung: ${overlapDiar.length} Stellen (${overlapDiar.reduce((n, [a, b]) => n + b - a, 0).toFixed(0)} s, ${bySpeaker.size} Sprecher)`)

  // 4) Einteilung je Qwen-only-Wort
  const counts = { overlap: 0, outsideVad: 0, edge: 0, interior: 0 }
  const recovered = { yes: 0, no: 0 }
  const fillWords = filled.flatMap((s) => s.words)
  const examples: string[] = []
  for (const q of qwenOnly) {
    const w: R = [q.start, q.end]
    const mid = (q.start + q.end) / 2
    const cause = [...overlapAsd, ...overlapDiar].some((o) => inter(w, o) > 0.5 * Math.max(0.05, q.end - q.start)) ? 'overlap'
      : !vad.some(([a, b]) => mid >= a && mid <= b) ? 'outsideVad'
      : vad.some(([a, b]) => Math.abs(mid - a) < 0.6 || Math.abs(mid - b) < 0.6) ? 'edge' : 'interior'
    counts[cause]++
    const got = fillWords.some((f) => Math.abs((f.start + f.end) / 2 - mid) < 1.0)
    if (got) recovered.yes++; else recovered.no++
    if (examples.length < 25 && q.group.words[0].start === q.start && q.group.words[0].w === q.w) {
      const prev = orig[q.before - 1]?.w ?? '', next = orig[q.before]?.w ?? ''
      examples.push(`  ${mid.toFixed(1)} s [${cause}${got ? ', von Lückenfüllung geholt' : ''}] …${prev} ⟦${q.group.words.map((x) => x.w).join(' ')}⟧ ${next}…`)
    }
  }
  const N = Math.max(1, qwenOnly.length)
  console.log('\n| Ursache (Qwen-only-Wörter) | Wörter | Anteil |\n|---|---|---|')
  const label: Record<string, string> = { overlap: 'gleichzeitiges Sprechen', outsideVad: 'außerhalb der VAD-Stücke (Sprache nicht erkannt)', edge: 'am Rand eines ASR-Stücks (≤ 0,6 s)', interior: 'mitten im Stück (Modell lässt aus)' }
  for (const k of Object.keys(counts) as Array<keyof typeof counts>) console.log(`| ${label[k]} | ${counts[k]} | ${((counts[k] / N) * 100).toFixed(0)} % |`)
  console.log(`| von der Lückenfüllung zurückgeholt (Zusatzspalte) | ${recovered.yes} | ${((recovered.yes / N) * 100).toFixed(0)} % |`)
  console.log('\nBeispielstellen:'); for (const e of examples) console.log(e)
  const key = (w: string): string => w.toLowerCase().replace(/[^\p{L}]/gu, '')
  const freq = new Map<string, number>()
  for (const q of qwenOnly) freq.set(key(q.w), (freq.get(key(q.w)) ?? 0) + 1)
  console.log('\nhäufigste Qwen-only-Wörter:', [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([w, n]) => `${w}×${n}`).join(' '))
  const lens = m.inserts.map((g) => g.words.length)
  console.log('Gruppen:', m.inserts.length, '· Länge 1:', lens.filter((l) => l === 1).length, '· 2–3:', lens.filter((l) => l >= 2 && l <= 3).length, '· ≥ 4:', lens.filter((l) => l >= 4).length)

  // 5) Untertitel-Darstellung: Wörter des Transkripts vs. Wörter in VTT / ASS (Standard-Preset)
  const preset = BUILTIN_PRESETS.find((p) => p.id === 'glow-karaoke') ?? BUILTIN_PRESETS[0]
  const caps = t.words.filter((w) => w.start < SEC).map((w) => ({ w: w.w, start: w.start, end: w.end }))
  const groups = groupWords(caps, preset.caption)
  const vtt = buildVtt(groups)
  const vttWords = vtt.split('\n').filter((l) => l && !/-->|WEBVTT/.test(l)).join(' ').replace(/<[\d:.]+>/g, '').split(/\s+/).filter(Boolean).length
  const ass = buildAss(caps, { width: 1080, height: 1920, style: preset.caption })
  // ASS: je Wort ein Zeitabschnitt, Ebene 2 trägt den Text → Anzahl der Ebene-2-Zeilen = Anzahl dargestellter Wörter
  const assWords = ass.split(/\r?\n/).filter((l) => l.startsWith('Dialogue: 2,')).length
  console.log(`\n| Untertitel-Darstellung | Wörter im Transkript | in Gruppen | in VTT | in ASS |\n|---|---|---|---|---|\n| erste ${SEC} s | ${caps.length} | ${groups.flat().length} | ${vttWords} | ${assWords} |`)
  void join
  await discardProject(hash)
}
main().then(() => process.exit(0)).catch((e) => { console.error('FAIL', e instanceof Error ? e.stack : e); process.exit(1) })
