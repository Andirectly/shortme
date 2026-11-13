/**
 * Echter Nahttest mit dem Tonmodell: saubere Nähte (an Wortgrenzen mit Pause) gegen absichtlich mitten im Wort gesetzte Nähte.
 *   SHORTME_DATA=<DATEN> npx tsx --tsconfig tsconfig.node.json scripts/v2-seam.ts <hash-präfix>
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { withAudio } from '../src/main/engines'
import { killAllSidecars } from '../src/main/engines/sidecars'
import { checkSeam, seamLevel } from '../src/main/shortme/clips/engines/v2/observe'
import { splitSentences } from '../src/main/shortme/clips/sentences'
import type { Transcript } from '../src/main/shortme/transcription'

async function main(): Promise<void> {
  const root = join(process.env.SHORTME_DATA ?? '', 'projects')
  const hash = readdirSync(root).find((d) => d.startsWith(process.argv[2] ?? '#'))!
  const t = JSON.parse(readFileSync(join(root, hash, 'transcript.json'), 'utf8')) as Transcript
  const wav = join(root, hash, 'audio.wav')
  const s = splitSentences(t.words)
  const clean: Array<[number, number]> = [], mid: Array<[number, number]> = []
  // saubere Nähte wie im Planer: Mitte der Lücke zwischen zwei Sätzen (nur Lücken ≥ 0,3 s)
  const gapMid = (i: number): number | null => (s[i + 1] && s[i + 1].start - s[i].end >= 0.3 ? (s[i].end + s[i + 1].start) / 2 : null)
  for (let i = 4; i < s.length - 40 && clean.length < 4; i++) { const a = gapMid(i), b = gapMid(i + 6); if (a !== null && b !== null) { clean.push([a, b]); i += 8 } }
  for (let i = 5; i < t.words.length - 80 && mid.length < 4; i += 37) { const a = t.words[i], b = t.words[i + 30]; mid.push([(a.start + a.end) / 2, (b.start + b.end) / 2]) }
  await withAudio(async (url) => {
    for (const [name, list] of [['sauber (Satzende → Satzanfang)', clean], ['mitten im Wort', mid]] as const) {
      for (const [a, b] of list) { const r = await checkSeam(url, wav, a, b); const la = await seamLevel(wav, a), lb = await seamLevel(wav, b); console.log(`${name} ${a.toFixed(1)}→${b.toFixed(1)} s: bestätigt=${r.confirmed} (${r.reason}) Pegelverhältnis ${la.ratio.toFixed(2)} / ${lb.ratio.toFixed(2)}`) }
    }
  })
}
main().catch((e) => { console.error('FEHLER', e); process.exitCode = 1 }).finally(() => killAllSidecars().then(() => process.exit()))
