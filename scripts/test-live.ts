/** Live-Puffer-Abnahme: Kanal <name> 50 s aufzeichnen, "letzte Minute" sichern, stoppen (Segmente müssen verschwinden).
 *   SHORTME_DATA=<Ordner> npx tsx --tsconfig tsconfig.node.json scripts/test-live.ts <kanal> */
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { liveStatus, saveLive, startLive, stopLive } from '../src/main/twitch/live'
import { dataRoot } from '../src/main/engines/paths'

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
async function main(): Promise<void> {
  await startLive(process.argv[2] ?? 'papaplatte')
  await wait(50_000)
  const st = liveStatus()
  console.log('STATUS', JSON.stringify(st))
  const saved = await saveLive(1)
  console.log('SAVED', JSON.stringify(saved))
  await stopLive()
  const dir = join(dataRoot(), 'live', 'segments')
  console.log('segments left:', existsSync(dir) ? readdirSync(dir).length : 0)
  console.log(st.running && st.bufferSec > 0 ? 'PASS' : 'FAIL')
}
main().then(() => process.exit(0)).catch((e) => { console.error('FAIL', e instanceof Error ? e.message : e); process.exit(1) })
