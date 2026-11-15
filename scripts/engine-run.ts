/**
 * Echter Lauf der neuen Engine auf einem vorhandenen, bereits transkribierten Projekt (Kopie in einem eigenen Datenordner; das Original bleibt unberührt).
 * Der Ordner <DATEN>/models muss auf die installierten Modelle zeigen (Junction), z. B. `cmd /c mklink /J <DATEN>\models %APPDATA%\cutawan\models`.
 *
 *   ENGINE=adaptive-v3 PROFILE=balanced SHORTME_DATA=<DATEN> npx tsx --tsconfig tsconfig.node.json scripts/engine-run.ts <projekt-hash-präfix> [inhaltstyp] [anzahl] [suchwunsch]
 */
import { cp, mkdir, readdir, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { killAllSidecars } from '../src/main/engines/sidecars'
import { runAnalysis } from '../src/main/shortme/clips/analysis'
import { loadState } from '../src/main/shortme/clips/engines/state'
import { projectDir } from '../src/main/shortme/project'
import type { ProjectMeta } from '../src/main/shortme/project'
import type { ContentType } from '../src/shared/videoKind'
import type { SelectionEngineId, V3Profile } from '../src/shared/engine'

const [prefix, kind = 'stream', n, ...q] = process.argv.slice(2)
const real = join(process.env.APPDATA ?? '', 'cutawan', 'projects')

async function main(): Promise<void> {
  if (!process.env.SHORTME_DATA) throw new Error('SHORTME_DATA fehlt')
  const hash = (await readdir(real)).find((d) => d.startsWith(prefix ?? '#'))
  if (!hash) throw new Error('Projekt nicht gefunden')
  await mkdir(projectDir(hash), { recursive: true })
  for (const f of ['project.json', 'transcript.json', 'audio.wav', 'signals.json', 'shots.json', 'events.json', 'asr.done', 'audio.done']) if (existsSync(join(real, hash, f))) await cp(join(real, hash, f), join(projectDir(hash), f), { force: false })
  const meta = JSON.parse(await readFile(join(projectDir(hash), 'project.json'), 'utf8')) as ProjectMeta
  if (!existsSync(meta.sourcePath)) throw new Error(`Quelldatei fehlt: ${meta.sourcePath}`)
  console.log(`Projekt ${hash.slice(0, 8)} · ${meta.durationSec.toFixed(0)} s · ${meta.title}`)
  let last = ''
  const t0 = Date.now()
  const file = await runAnalysis(meta, {
    engine: (process.env.ENGINE ?? 'multimodal-v2') as SelectionEngineId, profile: (process.env.PROFILE ?? 'balanced') as V3Profile, contentType: kind as ContentType, wanted: n ? Number(n) : undefined, query: q.join(' ') || undefined,
    onProgress: (stage, f, m) => { const line = `${stage}: ${m}`; if (line !== last) { last = line; console.log(`[${((Date.now() - t0) / 1000).toFixed(0)} s] ${line} (${Math.round(f * 100)} %)`) } }

  })
  console.log(`FERTIG nach ${((Date.now() - t0) / 1000).toFixed(0)} s: ${file.clips.length} Clips, Modus ${file.mode}, Lauf ${file.runId}`)
  for (const c of file.clips) {
    const cut = (c.autoCuts ?? []).reduce((a, x) => a + x.end - x.start, 0)
    console.log(` - ${c.id} ${c.start.toFixed(0)}–${c.end.toFixed(0)} s (${(c.end - c.start - cut).toFixed(0)} s) ${c.v2?.kind}/${c.v2?.verification} ${c.v2?.eventNote} | ${c.title} | Belege ${c.v2?.modalities.join('+')}${c.autoCuts?.length ? ` | Schnitte ${c.autoCuts.length}` : ''}${c.wordless ? ' | ohne Sprache' : ''}`)
  }
  const st = await loadState(hash)
  console.log('Läufe:', JSON.stringify(st.runs.map((r) => ({ id: r.runId, status: r.status, clips: r.clipCount, modalities: r.modalities, coverage: r.coverage, error: r.error }))))
}

main().catch((e) => { console.error('FEHLER', e); process.exitCode = 1 }).finally(() => killAllSidecars().then(() => process.exit()))
