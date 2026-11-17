/**
 * Engine 4 – echte Probe ohne Ton und ohne Sprache (V4-046): aus einem vorhandenen Projekt entsteht ein eigenes Projekt mit derselben Bildspur, aber
 * OHNE Tonspur (ffmpeg -an) und ohne Transkript-Wörter. Engine 4 läuft darauf vollständig. Erwartet: Ton-Lane übersprungen (ffprobe: kein Ton),
 * Sprach-Lane ohne Seeds, Bild-Lanes liefern Kandidaten, kein erfundener Ton; gerenderte Ausgabe hat nur Bild, `audio-seam` = not-applicable mit Grund.
 * Null Clips sind ein gültiges Ergebnis, wenn keine Kandidaten die Prüfung bestehen – dann zählt die korrekte Behandlung der fehlenden Spur.
 *   SHORTME_DATA=<Daten> npx tsx --tsconfig tsconfig.node.json scripts/v4-silent-check.ts <quell-projekt-hash>
 */
import { execFileSync } from 'node:child_process'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { killAllSidecars } from '../src/main/engines/sidecars'
import { FFMPEG_PATH } from '../src/main/pipeline/ffmpeg'
import { loadMeta, projectDir } from '../src/main/shortme/project'
import { runAnalysis } from '../src/main/shortme/clips/analysis'
import { loadState, runDir } from '../src/main/shortme/clips/engines/state'

async function main(): Promise<number> {
  const src = process.argv[2]
  const meta = await loadMeta(src)
  if (!meta) throw new Error('Quellprojekt fehlt im Datenordner')
  const hash = `${src.slice(0, 8)}silent0000000000000000000`.slice(0, 32)
  const dir = projectDir(hash)
  await mkdir(dir, { recursive: true })
  const video = join(dir, 'video-only.mp4')
  if (!existsSync(video)) execFileSync(FFMPEG_PATH, ['-hide_banner', '-loglevel', 'error', '-y', '-i', meta.sourcePath, '-an', '-c:v', 'copy', video])
  // Projekt ohne Ton: Transkript ohne Wörter, stille Signale, keine Ton-Ereignisse
  const t = JSON.parse(await readFile(join(projectDir(src), 'transcript.json'), 'utf8'))
  await writeFile(join(dir, 'transcript.json'), JSON.stringify({ ...t, words: [], segments: [], speech: [] }))
  await writeFile(join(dir, 'project.json'), JSON.stringify({ ...meta, hash, sourcePath: video, hasAudio: false, title: `${meta.title} (ohne Ton)` }))
  await copyFile(join(projectDir(src), 'audio.wav'), join(dir, 'audio.wav')).catch(() => undefined) // Signalberechnung braucht eine Datei; Engine 4 entscheidet über ffprobe der Quelle
  for (const f of ['shots.json', 'asr.done', 'audio.done']) await copyFile(join(projectDir(src), f), join(dir, f)).catch(() => undefined)
  const m2 = (await loadMeta(hash))!
  let err = ''
  try { await runAnalysis(m2, { engine: 'engine4', profile: 'fast', contentType: 'auto' as never, onProgress: (s: string, f: number, m: string) => process.stdout.write(`\r${s} ${Math.round(f * 100)}% ${m}`.slice(0, 110)) } as never) } catch (e) { err = e instanceof Error ? e.message : String(e) }
  console.log('')
  const st = await loadState(hash)
  const run = [...st.runs].reverse().find((r) => r.engineId === 'engine4')
  if (!run) { console.log('FAIL: kein Lauf', err); return 1 }
  const rd = runDir(hash, run.runId)
  const j = async (n: string): Promise<any> => JSON.parse(await readFile(join(rd, n), 'utf8')) // eslint-disable-line @typescript-eslint/no-explicit-any
  const man = await j('manifest.json'), cand = await j('candidates.json'), cov = await j('coverage.json'), ver = await j('verdicts.json')
  const audioSkipped = cov.windows.filter((w: any) => w.lane === 'audio').every((w: any) => w.status === 'skipped') // eslint-disable-line @typescript-eslint/no-explicit-any
  const noSpeechSeeds = cand.lanes.speech.seeds === 0
  const visualSeeds = (cand.lanes.visual?.seeds ?? 0) + (cand.lanes['cross-modal']?.seeds ?? 0)
  const judged = ver.filter((v: any) => v.judgement) // eslint-disable-line @typescript-eslint/no-explicit-any
  const audioNa = judged.every((v: any) => !v.rendered.streams.includes('audio') && v.judgement.criteria.find((c: any) => c.id === 'audio-seam')?.state === 'not-applicable') // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = { project: hash, runId: run.runId, status: man.status, sourceStreams: man.source.streams, audioLaneSkipped: audioSkipped, speechSeeds: cand.lanes.speech.seeds, visualSeeds, judgedOutputs: judged.length, audioSeamNotApplicable: audioNa, clips: run.clipCount ?? 0, error: err.slice(0, 160) }
  console.log(JSON.stringify(r, null, 1))
  const ok = !man.source.streams.includes('audio') && audioSkipped && noSpeechSeeds && visualSeeds > 0 && judged.length > 0 && audioNa && !err
  await writeFile(join(rd, 'silent-check.json'), JSON.stringify({ ...r, ok }, null, 1))
  console.log(ok ? 'PASS' : 'FAIL')
  return ok ? 0 : 1
}
main().then(async (c) => { await killAllSidecars(); process.exit(c) }).catch(async (e) => { console.error('FAIL', e); await killAllSidecars(); process.exit(1) })
