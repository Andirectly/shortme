/**
 * M4-Abnahme: Clip-Auswahl auf den Testvideos (Transkript aus M3 nötig, Cache im Datenordner).
 * Automatische Prüfungen: kein Clip beginnt/endet mitten im Wort oder Satz, keine Überlappung, Länge ≤ 90 s,
 * Tags/Score/Titel vorhanden. Ausgabe der Clip-Ränder zur manuellen Prüfung.
 *
 *   SHORTME_DATA=.tmp/fresh npx tsx --tsconfig tsconfig.node.json scripts/test-clips.ts [--nollm] [video...]
 */
import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { importFile } from '../src/main/shortme/importer'
import { loadTranscript, runTranscription } from '../src/main/shortme/transcription'
import { runAnalysis } from '../src/main/shortme/clips/analysis'
import { splitSentences } from '../src/main/shortme/clips/sentences'
import { killAllSidecars } from '../src/main/engines/sidecars'

const args = process.argv.slice(2)
const noLlm = args.includes('--nollm')
const videos = args.filter((a) => !a.startsWith('--'))
const list = videos.length ? videos : ['test-videos/podcast-2p.mp4', 'test-videos/solo.mp4', 'test-videos/nofaces.mp4'].filter(existsSync)
let failures = 0
const check = (ok: boolean, msg: string): void => { console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`); if (!ok) failures++ }
const report: string[] = []

async function main(): Promise<void> {
  for (const v of list) {
    const imp = await importFile(v)
    await runTranscription(imp.meta)
    const t = (await loadTranscript(imp.meta.hash))!
    const sentences = splitSentences(t.words)
    const t0 = Date.now()
    let last = ''
    const res = await runAnalysis(imp.meta, { noLlm, onProgress: (s, f, m) => { const k = `${s}${Math.floor(f * 5)}`; if (k !== last) { last = k; console.log(`  ${s} ${(f * 100).toFixed(0)}% ${m}`) } } })
    console.log(`ANALYSE ${v}: ${res.clips.length} Clips (${res.mode}) in ${((Date.now() - t0) / 1000).toFixed(0)} s`)
    check(res.clips.length >= 1, `${v}: mindestens ein Clip`)
    report.push(`\n## ${v} (${res.mode}, ${res.clips.length} Clips)`)
    const sorted = [...res.clips].sort((a, b) => a.start - b.start)
    sorted.forEach((c, i) => {
      const fw = t.words[c.firstWord]
      const lw = t.words[c.lastWord]
      const startsSentence = sentences.some((s) => s.first === c.firstWord)
      const endsSentence = sentences.some((s) => s.last === c.lastWord)
      const cutWords = t.words.filter((w) => (w.start < c.start - 1e-6 && w.end > c.start + 1e-6) || (w.start < c.end - 1e-6 && w.end > c.end + 1e-6))
      const tail = c.end - lw.end
      const len = c.end - c.start
      check(cutWords.length === 0, `${v} #${c.id}: kein Wort angeschnitten`)
      check(startsSentence && endsSentence, `${v} #${c.id}: beginnt am Satzanfang, endet am Satzende (${startsSentence}/${endsSentence})`)
      check(tail >= 0 && tail <= 0.6 + 1e-6 && fw.start - c.start >= 0 && fw.start - c.start <= 0.5, `${v} #${c.id}: Rand-Puffer ok (Vorlauf ${(fw.start - c.start).toFixed(2)} s, Nachlauf ${tail.toFixed(2)} s)`)
      check(len <= 90 && len >= 8, `${v} #${c.id}: Länge ${len.toFixed(0)} s in 8–90`)
      if (i > 0) check(c.start >= sorted[i - 1].end - 1e-6, `${v} #${c.id}: keine Überlappung`)
      check(c.score >= 0 && c.score <= 100 && !!c.title && !!c.hookText && !!c.reason, `${v} #${c.id}: Score/Titel/Hook/Begründung`)
      const text = t.words.slice(c.firstWord, c.lastWord + 1).map((w) => w.w)
      report.push(`- **${c.score}** ${c.id} ${c.start.toFixed(1)}–${c.end.toFixed(1)} s (${len.toFixed(0)} s, snap: ${c.snap.join('+')}, +${c.extended} Satz verlängert) „${c.title}“ | Hook: ${c.hookText}\n  - Anfang: ${text.slice(0, 14).join(' ')}\n  - Ende: … ${text.slice(-14).join(' ')}\n  - Warum: ${c.reason}\n  - Tags: ${c.tags.map((g) => `${t.words[g.word].w}:${g.kind}`).join(', ')}`)
    })
  }
  await writeFile('.tmp/clips-report.md', report.join('\n'))
  console.log(failures === 0 ? 'PASS alles' : `FAIL ${failures} Prüfung(en)`)
  await killAllSidecars()
  process.exit(failures === 0 ? 0 : 1)
}

main().catch(async (e) => { console.error('FAIL', e); await killAllSidecars(); process.exit(1) })
