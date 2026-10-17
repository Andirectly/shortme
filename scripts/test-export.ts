/**
 * M6-Abnahme: echte Clips exportieren (clips.json aus M4/M5 nötig).
 * Prüft: Datei vorhanden, 1080×1920, Dauer = geplante gekürzte Dauer, Lautheit −14 ±1 LUFS, Audio vorhanden;
 * schreibt je Clip 5 Standbilder nach .tmp/export-frames zur Sichtprüfung (Vorschau = Export).
 *
 *   SHORTME_DATA=.tmp/fresh npx tsx --tsconfig tsconfig.node.json scripts/test-export.ts [video] [maxClips]
 */
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { importFile } from '../src/main/shortme/importer'
import { ensureSignals, loadClips } from '../src/main/shortme/clips/analysis'
import { loadTranscript } from '../src/main/shortme/transcription'
import { exportClip, planExport } from '../src/main/shortme/render/exporter'
import { measureLoudness } from '../src/main/pipeline/loudness'
import { probeVideo, runFfmpeg } from '../src/main/pipeline/ffmpeg'

const video = process.argv[2] ?? 'test-videos/podcast-2p.mp4'
const maxClips = Number(process.argv[3] ?? 2)
let failures = 0
const check = (ok: boolean, msg: string): void => { console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`); if (!ok) failures++ }

async function main(): Promise<void> {
  if (!existsSync(video)) throw new Error(`Video fehlt: ${video}`)
  const imp = await importFile(video)
  const file = await loadClips(imp.meta.hash)
  const t = await loadTranscript(imp.meta.hash)
  if (!file || !t) throw new Error('clips.json/transcript.json fehlen – erst test-clips.ts laufen lassen')
  const signals = await ensureSignals(imp.meta)
  const out = join('.tmp', 'export-out')
  await mkdir(join('.tmp', 'export-frames'), { recursive: true })
  for (const clip of file.clips.slice(0, maxClips)) {
    const plan = planExport(clip, t, signals, true)
    const t0 = Date.now()
    const res = await exportClip(imp.meta, clip, t, signals, { outDir: out, srt: true, presetId: 'impact' })
    const sec = (Date.now() - t0) / 1000
    const info = await probeVideo(res.path)
    console.log(`EXPORT ${clip.id}: ${res.path} ${info.width}×${info.height} ${info.durationSec.toFixed(2)} s (geplant ${plan.duration.toFixed(2)} s, Quelle ${(clip.end - clip.start).toFixed(1)} s, ${plan.cuts.length} Pausen, ${res.pieces} Stücke) in ${sec.toFixed(0)} s = ${(sec / info.durationSec).toFixed(2)}× Echtzeit`)
    check(info.width === 1080 && info.height === 1920, `${clip.id}: 1080×1920`)
    check(info.hasAudio, `${clip.id}: Audiospur vorhanden`)
    check(Math.abs(info.durationSec - plan.duration) < 0.15, `${clip.id}: Dauer = gekürzte Plandauer (Δ ${(info.durationSec - plan.duration).toFixed(3)} s)`)
    const loud = await measureLoudness(res.path, 0, info.durationSec)
    console.log(`  Lautheit ${loud?.inputI}`)
    check(!!loud && Math.abs(loud.inputI - -14) <= 1, `${clip.id}: Lautheit −14 ±1 LUFS (${loud?.inputI})`)
    check(!!res.srtPath && existsSync(res.srtPath), `${clip.id}: SRT geschrieben`)
    for (let i = 0; i < 5; i++) {
      const at = (info.durationSec * (i + 0.5)) / 5
      await runFfmpeg(['-y', '-ss', at.toFixed(2), '-i', res.path, '-frames:v', '1', '-vf', 'scale=270:-2', '-q:v', '4', join('.tmp', 'export-frames', `${clip.id}-${i}.jpg`)])
    }
  }
  console.log(failures === 0 ? 'PASS alles' : `FAIL ${failures} Prüfung(en)`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => { console.error('FAIL', e); process.exit(1) })
