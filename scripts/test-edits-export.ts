/**
 * M7-Abnahme: Editor-Operationen wirken im Export (Beschnitt, herausgeschnittene Wörter, Hook, Untertitel-Stil, Kamera).
 *   SHORTME_DATA=.tmp/fresh npx tsx --tsconfig tsconfig.node.json scripts/test-edits-export.ts [video]
 */
import { importFile } from '../src/main/shortme/importer'
import { presetById, resolvePreset } from '../src/shared/preset'
import { ensureSignals, loadClips } from '../src/main/shortme/clips/analysis'
import { loadTranscript } from '../src/main/shortme/transcription'
import { exportClip } from '../src/main/shortme/render/exporter'
import { loadEdits, saveEdits } from '../src/main/shortme/edits'
import { baseState, effectiveClip, emptyLog, push, stateOf, undo } from '../src/shared/edits'
import { probeVideo } from '../src/main/pipeline/ffmpeg'

let failures = 0
const check = (ok: boolean, msg: string): void => { console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`); if (!ok) failures++ }

async function main(): Promise<void> {
  const imp = await importFile(process.argv[2] ?? 'test-videos/podcast-2p.mp4')
  const file = (await loadClips(imp.meta.hash))!
  const t = (await loadTranscript(imp.meta.hash))!
  const signals = await ensureSignals(imp.meta)
  const clip = file.clips[0]
  const out = '.tmp/export-edits'
  const run = async (c: typeof clip, extra: Partial<Parameters<typeof exportClip>[4]>) => exportClip(imp.meta, c, t, signals, { removePauses: false, ...extra, outDir: out })

  const plain = await run(clip, {})
  const plainDur = (await probeVideo(plain.path)).durationSec

  // Operationen: 3 Wörter in der Mitte herausschneiden, Hook ändern, Untertitel größer/höher, Person anklicken
  const mid = Math.floor((clip.firstWord + clip.lastWord) / 2)
  const cutIdx = [mid, mid + 1, mid + 2]
  let log = emptyLog(clip.id)
  log = push(log, { t: 'cutWords', words: cutIdx, cut: true })
  log = push(log, { t: 'hook', text: 'Mein neuer Hook' })
  log = push(log, { t: 'caption', patch: { presetId: 'pop', highlight: false, style: { caption: { y: 0.5, sizePx: 110 } } } })
  log = push(log, { t: 'follow', at: clip.start + 10, cx: 0.8 })
  await saveEdits(imp.meta.hash, log)
  const loaded = await loadEdits(imp.meta.hash, clip.id)
  check(loaded.ops.length === 4 && loaded.cursor === 4, 'Edit-Log wird gespeichert und wieder geladen')

  const st = stateOf(baseState(clip), loaded)
  const eff = effectiveClip(clip, t.words, st)
  check(eff.removed.length === 3, 'drei Wörter als Schnittbereiche gemeldet')
  const res = await run(eff, { style: resolvePreset(presetById(st.caption.presetId), st.caption.style), extraCuts: eff.removed, caption: { highlight: st.caption.highlight }, hookText: st.hook.text, hookSeconds: st.hook.seconds })
  const dur = (await probeVideo(res.path)).durationSec
  const removed = eff.removed.reduce((n, [a, b]) => n + (b - a), 0)
  console.log(`ohne Edits ${plainDur.toFixed(2)} s, mit Edits ${dur.toFixed(2)} s (entfernt ${removed.toFixed(2)} s)`)
  check(Math.abs(plainDur - dur - removed) < 0.2, 'Export kürzer um die herausgeschnittenen Wörter')
  check(res.ass.includes('Mein neuer Hook'), 'neuer Hook im Export')
  for (const i of cutIdx) check(!res.ass.toLowerCase().includes(`,${t.words[i].w.toLowerCase().replace(/[.,!?]/g, '')}\n`) || t.words[i].w.length < 3, `Wort „${t.words[i].w}“ nicht in den Untertiteln`)
  check(!res.ass.includes('&H8A5CFF&'), 'Hervorhebung aus → keine Highlight-Farbe in den Untertiteln')

  // Beschnitt: Ende 6 s früher → kürzer; Undo bis zum Anfang stellt den Originalclip wieder her
  const trimmed = push(emptyLog(clip.id), { t: 'trim', start: clip.start, end: clip.end - 6 })
  const e2 = effectiveClip(clip, t.words, stateOf(baseState(clip), trimmed))
  check(e2.end === clip.end - 6 && e2.lastWord < clip.lastWord, 'Beschnitt verkürzt den Clip und die Wortgrenze')
  const back = effectiveClip(clip, t.words, stateOf(baseState(clip), undo(trimmed)))
  check(back.start === clip.start && back.end === clip.end && back.lastWord === clip.lastWord, 'Undo stellt den Originalclip wieder her')
  console.log(failures === 0 ? 'PASS alles' : `FAIL ${failures} Prüfung(en)`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => { console.error('FAIL', e); process.exit(1) })
