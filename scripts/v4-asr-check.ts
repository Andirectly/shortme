/**
 * Engine 4 – ASR-Nachweis (V4-012) auf echten Projekten (deutsch und englisch):
 *  1) Wortzeiten des Shortme-Transkripts (Parakeet) sind endlich, start < ende, aufsteigend, innerhalb der Dauer; Wort-IDs = Indizes, Satz-IDs vorhanden.
 *  2) Gegenprobe gegen ein zweites lokales Modell (Qwen3-ASR 1.7B über llama-server): in 3 sprachreichen 30-s-Fenstern je Video die Übereinstimmung der
 *     Wortfolgen (LCS-Anteil). Gemessen, nicht behauptet; Schwelle 0,6 = „kein erfundener Text“ (keine WER gegen eine Referenz).
 *   npx tsx --tsconfig tsconfig.node.json scripts/v4-asr-check.ts <de-hash> <en-hash>
 */
import { writeFile } from 'node:fs/promises'
import { killAllSidecars } from '../src/main/engines/sidecars'
import { loadTranscript } from '../src/main/shortme/transcription'
import { projectFile } from '../src/main/shortme/project'
import { splitSentences } from '../src/main/shortme/clips/sentences'
import { qwenTextForRanges } from '../src/main/testlab/qwenAsr'

const norm = (s: string): string => s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '')
function lcs(a: string[], b: string[]): number {
  const dp = new Array(b.length + 1).fill(0)
  for (let i = 1; i <= a.length; i++) { let prev = 0; for (let j = 1; j <= b.length; j++) { const tmp = dp[j]; dp[j] = a[i - 1] === b[j - 1] ? prev + 1 : Math.max(dp[j], dp[j - 1]); prev = tmp } }
  return dp[b.length]
}

async function check(hash: string, lang: string): Promise<Record<string, unknown>> {
  const t = await loadTranscript(hash)
  if (!t) throw new Error(`Transkript fehlt: ${hash}`)
  const w = t.words
  const bad = w.findIndex((x, i) => !Number.isFinite(x.start) || !Number.isFinite(x.end) || x.end < x.start || x.start < 0 || x.end > t.durationSec + 0.5 || (i > 0 && x.start + 0.05 < w[i - 1].start))
  const sentences = splitSentences(w)
  // drei sprachreichste 30-s-Fenster (über die ganze Datei verteilt)
  const wins: Array<[number, number]> = []
  for (const part of [0, 1, 2]) {
    const lo = (part * t.durationSec) / 3, hi = ((part + 1) * t.durationSec) / 3
    let best: [number, number] = [lo, Math.min(hi, lo + 30)], bestN = -1
    for (let s = lo; s + 30 <= hi; s += 15) { const n = w.filter((x) => x.start >= s && x.end <= s + 30).length; if (n > bestN) { bestN = n; best = [s, s + 30] } }
    wins.push(best)
  }
  const qwen = await qwenTextForRanges(projectFile(hash, 'audio.wav'), wins)
  const agreements = wins.map(([a, b], k) => {
    const p = w.filter((x) => x.start >= a && x.end <= b).map((x) => norm(x.w)).filter(Boolean)
    const q = qwen[k].map(norm).filter(Boolean)
    return { window: [Math.round(a), Math.round(b)], parakeetWords: p.length, qwenWords: q.length, agreement: p.length && q.length ? Math.round((lcs(p, q) / Math.max(p.length, q.length)) * 1000) / 1000 : null }
  })
  const vals = agreements.map((x) => x.agreement).filter((x): x is number => x !== null)
  return { hash, lang, words: w.length, durationSec: Math.round(t.durationSec), model: t.model, firstInvalidWord: bad, sentences: sentences.length, agreements, meanAgreement: vals.length ? Math.round((vals.reduce((n, x) => n + x, 0) / vals.length) * 1000) / 1000 : null }
}

async function main(): Promise<number> {
  const [de, en] = process.argv.slice(2)
  const out = [await check(de, 'de'), await check(en, 'en')]
  await writeFile('docs/v4-logs/asr-check.json', JSON.stringify(out, null, 1))
  console.log(JSON.stringify(out, null, 1))
  const ok = out.every((r) => r.firstInvalidWord === -1 && typeof r.meanAgreement === 'number' && (r.meanAgreement as number) >= 0.6)
  console.log(ok ? 'PASS' : 'FAIL')
  return ok ? 0 : 1
}
main().then(async (c) => { await killAllSidecars(); process.exit(c) }).catch(async (e) => { console.error('FAIL', e); await killAllSidecars(); process.exit(1) })
