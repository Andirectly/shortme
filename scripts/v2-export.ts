/**
 * Kurzer echter Export eines Clips der neuen Engine mit denselben Planungsdaten wie die Vorschau (planExport/TimeMap) und Längenprüfung per FFmpeg.
 *   SHORTME_DATA=<DATEN> npx tsx --tsconfig tsconfig.node.json scripts/v2-export.ts <hash-präfix> [clip-id-ende, z. B. c1]
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { loadClips } from '../src/main/shortme/clips/analysis'
import { ensureSignals } from '../src/main/shortme/clips/analysis'
import { loadMeta, projectDir } from '../src/main/shortme/project'
import { loadTranscript } from '../src/main/shortme/transcription'
import { exportClip, planExport } from '../src/main/shortme/render/exporter'
import { effectiveClip, baseState, emptyLog, stateOf } from '../src/shared/edits'
import { loadState } from '../src/main/shortme/clips/engines/state'
import { FFMPEG_PATH } from '../src/main/pipeline/ffmpeg'
import { readdirSync } from 'node:fs'

async function main(): Promise<void> {
  const [prefix, suffix = 'c1', cutA, cutB] = process.argv.slice(2)
  const hash = readdirSync(join(process.env.SHORTME_DATA ?? '', 'projects')).find((d) => d.startsWith(prefix ?? '#'))
  if (!hash) throw new Error('Projekt nicht gefunden')
  const state = await loadState(hash)
  const run = [...state.runs].reverse().find((r) => r.engineId === 'multimodal-v2' && (r.clipCount ?? 0) > 0)
  if (!run) throw new Error('kein V2-Lauf mit Clips')
  const file = (await loadClips(hash, run.runId))!
  const found = file.clips.find((c) => c.id.endsWith(`-${suffix}`)) ?? file.clips[0]
  // optional: eine automatische Kürzung nur für diesen Test (im Speicher) einsetzen, um den Mehrstück-Pfad mit echtem Export zu prüfen
  const clip = cutA && cutB ? { ...found, autoCuts: [{ start: Number(cutA), end: Number(cutB) }] } : found
  const meta = (await loadMeta(hash))!, t = (await loadTranscript(hash))!, signals = await ensureSignals(meta)
  // Vorschau und Export rufen dieselbe Planung: Ausgabelänge vorab aus planExport
  const eff = effectiveClip(clip, t.words, stateOf(baseState(clip), emptyLog(clip.id)))
  const plan = planExport(eff, t, signals, false, eff.removed)
  console.log(`Clip ${clip.id}: Quelle ${clip.start.toFixed(1)}–${clip.end.toFixed(1)} s, automatische Schnitte ${JSON.stringify(clip.autoCuts ?? [])}, geplante Länge ${plan.duration.toFixed(2)} s, ${plan.words.length} Untertitel-Wörter, ${plan.pieces.length} Stücke`)
  const out = join(projectDir(hash), 'export-test')
  mkdirSync(out, { recursive: true })
  const res = await exportClip(meta, eff, t, signals, { outDir: out, removePauses: false, extraCuts: eff.removed, engine: 'ass' })
  const probe = execFileSync(FFMPEG_PATH, ['-hide_banner', '-i', res.path], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).toString()
  console.log('Export:', res.path, `Länge laut Export ${res.durationSec.toFixed(2)} s`, probe)
}

main().catch((e: unknown) => {
  const msg = e instanceof Error ? e.message : String(e)
  // ffmpeg -i ohne Ausgabedatei endet absichtlich mit Fehlercode 1 und schreibt die Dauer auf stderr
  const m = /Duration: (\d+:\d+:[\d.]+)/.exec((e as { stderr?: string }).stderr ?? '')
  if (m) { console.log('Dauer laut Datei:', m[1]); return }
  console.error('FEHLER', msg); process.exitCode = 1
})
