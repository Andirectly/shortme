/** Twitch-Gesamttest: VOD-Ausschnitt importieren (Chat aus), transkribieren, Clips finden (Stream/Gaming), Ergebnis ausgeben, Projekt löschen.
 *   SHORTME_DATA=<Datenordner mit Modellen> npx tsx --tsconfig tsconfig.node.json scripts/test-twitch-pipeline.ts <vod-url> <von-bis> */
import { importTwitch } from '../src/main/twitch/import'
import { runTranscription } from '../src/main/shortme/transcription'
import { loadClips, runAnalysis } from '../src/main/shortme/clips/analysis'
import { discardProject, loadMeta } from '../src/main/shortme/project'

async function main(): Promise<void> {
  const [url, range] = process.argv.slice(2)
  const section = range.split('-').map(Number) as [number, number]
  const t0 = Date.now()
  const res = await importTwitch(url, { section }, (p, m) => { if (Math.round(p * 100) % 25 === 0) console.log(`${Math.round(p * 100)} % ${m}`) })
  console.log('IMPORT', res.meta.durationSec.toFixed(0), 's', JSON.stringify(res.meta.twitch))
  const meta = (await loadMeta(res.meta.hash))!
  await runTranscription(meta, { diarize: false, onProgress: (p) => { if (p.fraction === 1) console.log('ASR', p.stage) } })
  await runAnalysis(meta, { contentType: 'stream', onProgress: (stage, f, msg) => { if (f === 1 || f === 0) console.log(stage, msg) } })
  const clips = (await loadClips(meta.hash))?.clips ?? []
  console.log('CLIPS', clips.length, 'in', ((Date.now() - t0) / 1000).toFixed(0), 's')
  for (const c of clips.slice(0, 5)) console.log(` ${c.score} ${c.start.toFixed(0)}-${c.end.toFixed(0)} chat=${c.chat ?? '-'} ${c.title}`)
  await discardProject(meta.hash)
  console.log(clips.length > 0 && !clips.some((c) => c.chat !== undefined) ? 'PASS (ohne Chat)' : 'FAIL')
}
main().then(() => process.exit(0)).catch((e) => { console.error('FAIL', e instanceof Error ? e.stack : e); process.exit(1) })
