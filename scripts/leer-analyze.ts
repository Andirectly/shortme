/** LEER-Diagnose Schritt 2: Transkription + Analyse für ein Projekt, dann Clips/Shots rund um eine Zeit ausgeben.
 *   SHORTME_DATA=<Daten> npx tsx --tsconfig tsconfig.node.json scripts/leer-analyze.ts <hash> [Sekunde=84] */
import { loadMeta } from '../src/main/shortme/project'
import { loadTranscript, runTranscription } from '../src/main/shortme/transcription'
import { loadClips, runAnalysis } from '../src/main/shortme/clips/analysis'

async function main(): Promise<void> {
  const [hash, sec = '84'] = process.argv.slice(2)
  const meta = (await loadMeta(hash))!
  if (!(await loadTranscript(hash))) await runTranscription(meta, {})
  if (!(await loadClips(hash))) await runAnalysis(meta, {})
  const t = Number(sec)
  const clips = (await loadClips(hash))!.clips
  for (const c of clips) {
    const hit = t >= c.start && t <= c.end
    console.log(`${hit ? '>>' : '  '} ${c.id} ${c.start.toFixed(1)}-${c.end.toFixed(1)} (${(c.end - c.start).toFixed(0)} s) faceRatio ${c.faceRatio?.toFixed(2)} ${c.title}`)
    if (hit) for (const s of c.shots ?? []) console.log(`     Shot ${(c.start + s.start).toFixed(1)}-${(c.start + s.end).toFixed(1)} ${s.layout} cx=${s.cx.toFixed(3)} zoom=${s.zoom}`)
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error('FAIL', e instanceof Error ? e.stack : e); process.exit(1) })
