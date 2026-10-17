/**
 * M3-Abnahme: Import + Transkription der Testvideos, Fortsetzen nach Abbruch, Cache beim zweiten Lauf.
 *
 *   SHORTME_DATA=.tmp/fresh npx tsx --tsconfig tsconfig.node.json scripts/test-transcribe.ts [video...]
 */
import { existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { importFile } from '../src/main/shortme/importer'
import { projectFile } from '../src/main/shortme/project'
import { loadTranscript, readCheckpoint, runTranscription, type Transcript } from '../src/main/shortme/transcription'
import { killAllSidecars } from '../src/main/engines/sidecars'

const videos = process.argv.slice(2).length ? process.argv.slice(2) : ['test-videos/podcast-2p.mp4', 'test-videos/solo.mp4', 'test-videos/nofaces.mp4'].filter(existsSync)
let failures = 0
const check = (ok: boolean, msg: string): void => { console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`); if (!ok) failures++ }

function sane(t: Transcript): string | null {
  let prev = -1
  for (const w of t.words) {
    if (w.start < prev - 1e-6) return `Wortzeiten nicht monoton bei „${w.w}“ (${w.start})`
    if (w.end < w.start) return `Wortende vor Wortanfang bei „${w.w}“`
    if (w.start > t.durationSec + 1) return `Wort jenseits der Videodauer: ${w.start}`
    prev = w.start
  }
  return t.words.length === 0 ? 'keine Wörter' : null
}

async function main(): Promise<void> {
  const results: Record<string, Transcript> = {}
  for (const v of videos) {
    const imp = await importFile(v)
    console.log(`IMPORT ${v}: ${imp.meta.hash} ${imp.meta.durationSec.toFixed(0)}s preflight=${imp.preflight.ok ? 'ok' : imp.preflight.errors.join(';')} cached=${imp.cached} stills=${existsSync(projectFile(imp.meta.hash, 'ambient.jpg'))}`)
    check(imp.preflight.ok, `${v}: Vorabprüfung`)
    check(existsSync(projectFile(imp.meta.hash, 'ambient.jpg')) && existsSync(projectFile(imp.meta.hash, 'poster.jpg')), `${v}: Standbilder`)
    // frischer Lauf (Cache der Transkription löschen, Audio darf bleiben)
    for (const f of ['transcript.json', 'asr.jsonl', 'asr.done', 'speakers.json']) await rm(projectFile(imp.meta.hash, f), { force: true })
    const t0 = Date.now()
    let last = ''
    const t = await runTranscription(imp.meta, { diarize: true, onProgress: (p) => { const k = `${p.stage}${Math.floor(p.fraction * 4)}`; if (k !== last) { last = k; console.log(`  ${p.stage} ${(p.fraction * 100).toFixed(0)}% ${p.message}`) } } })
    const sec = (Date.now() - t0) / 1000
    console.log(`TRANSCRIBE ${v}: ${t.words.length} Wörter, ${t.segments.length} Segmente, ${t.speakers} Sprecher, ${sec.toFixed(0)}s (${(sec / imp.meta.durationSec).toFixed(3)}× Echtzeit)`)
    check(sane(t) === null, `${v}: Transkript plausibel ${sane(t) ?? ''}`)
    check(t.diarized && t.words.every((w) => typeof w.speaker === 'number'), `${v}: Sprecher-IDs je Wort`)
    check(t.speech.length > 0, `${v}: VAD-Intervalle gespeichert`)
    results[v] = t

    // zweiter Lauf: Cache
    const c0 = Date.now()
    let msg = ''
    const again = await runTranscription(imp.meta, { diarize: true, onProgress: (p) => { msg = p.message } })
    check(Date.now() - c0 < 1500 && msg === 'Aus dem Cache' && again.words.length === t.words.length, `${v}: zweiter Lauf nutzt Cache (${Date.now() - c0} ms)`)
  }

  // Fortsetzen nach Abbruch mitten in der Transkription (erstes Video)
  const v = videos[0]
  const imp = await importFile(v)
  const base = results[v]
  for (const f of ['transcript.json', 'asr.jsonl', 'asr.done']) await rm(projectFile(imp.meta.hash, f), { force: true })
  const ac = new AbortController()
  let aborted = false
  await runTranscription(imp.meta, { signal: ac.signal, onProgress: (p) => { if (p.stage === 'asr' && p.fraction > 0.4 && !aborted) { aborted = true; ac.abort('pause') } } }).catch((e) => console.log(`  abgebrochen: ${e.message}`))
  const partial = await readCheckpoint(imp.meta.hash)
  const partialEnd = partial.length ? partial[partial.length - 1].end : 0
  check(aborted && partial.length > 0 && !existsSync(projectFile(imp.meta.hash, 'asr.done')) && !(await loadTranscript(imp.meta.hash)), `${v}: Abbruch hinterlässt Checkpoint (${partial.length} Segmente bis ${partialEnd.toFixed(0)} s, kein Endergebnis)`)
  let resumedMsg = ''
  const resumed = await runTranscription(imp.meta, { onProgress: (p) => { if (p.stage === 'asr' && !resumedMsg) resumedMsg = p.message } })
  check(/fort/i.test(resumedMsg), `${v}: Neustart setzt fort ("${resumedMsg}")`)
  const diff = Math.abs(resumed.words.length - base.words.length) / base.words.length
  check(diff < 0.01, `${v}: Fortgesetztes Ergebnis ≈ Volllauf (${resumed.words.length} vs ${base.words.length} Wörter, Δ ${(diff * 100).toFixed(2)} %)`)
  check(sane(resumed) === null, `${v}: fortgesetztes Transkript plausibel`)

  console.log(failures === 0 ? 'PASS alles' : `FAIL ${failures} Prüfung(en)`)
  await killAllSidecars()
  process.exit(failures === 0 ? 0 : 1)
}

main().catch(async (e) => { console.error('FAIL', e); await killAllSidecars(); process.exit(1) })
