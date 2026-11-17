/**
 * Engine 4 – echte Abbruchprobe (V4-008/046): startet einen V4-Lauf über runAnalysis und bricht ihn nach N Sekunden ab (mitten in einer Modellphase).
 * Erwartet: der Job endet mit Abbruch, das Lauf-Manifest steht auf „cancelled“, im Zustand ist der Lauf nicht „done“, und KEIN Worker-/llama-Prozess bleibt übrig.
 *   SHORTME_DATA=<Daten> npx tsx --tsconfig tsconfig.node.json scripts/v4-cancel-check.ts <projekt-hash> [sekunden]
 */
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { killAllSidecars } from '../src/main/engines/sidecars'
import { loadMeta } from '../src/main/shortme/project'
import { runAnalysis } from '../src/main/shortme/clips/analysis'
import { loadState, runDir } from '../src/main/shortme/clips/engines/state'

const workerProcs = (): string[] => {
  const out = execFileSync('powershell', ['-NoProfile', '-Command', "Get-CimInstance Win32_Process | Where-Object { ($_.Name -eq 'python.exe' -and $_.CommandLine -like '*worker.py*') -or $_.Name -eq 'llama-server.exe' } | ForEach-Object { $_.ProcessId }"], { encoding: 'utf8' })
  return out.split(/\s+/).filter(Boolean)
}

async function main(): Promise<number> {
  const [hash, secs = '45'] = process.argv.slice(2)
  const meta = await loadMeta(hash)
  if (!meta) throw new Error('Projekt fehlt')
  const before = workerProcs()
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), Number(secs) * 1000)
  let rejected = false, msg = ''
  try { await runAnalysis(meta, { engine: 'engine4', profile: 'balanced', contentType: 'auto' as never, signal: ac.signal, onProgress: (st: string, f: number, m: string) => process.stdout.write(`\r${st} ${Math.round(f * 100)}% ${m}`.slice(0, 120)) } as never) } catch (e) { rejected = true; msg = e instanceof Error ? e.message : String(e) }
  clearTimeout(t)
  console.log('')
  const st = await loadState(hash)
  const run = [...st.runs].reverse().find((r) => r.engineId === 'engine4')!
  const manifest = JSON.parse(await readFile(join(runDir(hash, run.runId), 'manifest.json'), 'utf8')) as { status: string }
  // beendete Windows-Prozesse bleiben kurz sichtbar, solange ein Handle offen ist: bis zu 20 s nachsehen
  let left: string[] = []
  for (let i = 0; i < 20; i++) { left = workerProcs().filter((p) => !before.includes(p)); if (!left.length) break; await new Promise((r) => setTimeout(r, 1000)) }
  const leftInfo = left.length ? execFileSync('powershell', ['-NoProfile', '-Command', `Get-CimInstance Win32_Process | Where-Object { @(${left.join(',')}) -contains $_.ProcessId } | ForEach-Object { $_.Name + ' ' + $_.CommandLine.Substring(0, [Math]::Min(120, $_.CommandLine.Length)) }`], { encoding: 'utf8' }).trim() : ''
  const ok = rejected && manifest.status === 'cancelled' && run.status !== 'done' && left.length === 0
  console.log(JSON.stringify({ runId: run.runId, rejected, message: msg.slice(0, 120), manifestStatus: manifest.status, stateStatus: run.status, leftoverProcesses: left, leftInfo }, null, 1))
  console.log(ok ? 'PASS' : 'FAIL')
  return ok ? 0 : 1
}
main().then(async (c) => { await killAllSidecars(); process.exit(c) }).catch(async (e) => { console.error('FAIL', e); await killAllSidecars(); process.exit(1) })
