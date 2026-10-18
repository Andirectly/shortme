/** Twitch-Abnahme im Datenordner SHORTME_DATA: Werkzeuge laden, Link prüfen, importieren, stumme Abschnitte suchen.
 *   SHORTME_DATA=<Ordner> npx tsx --tsconfig tsconfig.node.json scripts/test-twitch.ts <url> [von-bis in s | letzte-Minuten] */
import { ensureTool, toolVersion } from '../src/main/twitch/tools'
import { inspectTwitch, importTwitch } from '../src/main/twitch/import'

async function main(): Promise<void> {
  const [url, arg] = process.argv.slice(2)
  if (process.env.TOOLS) {
    for (const id of ['streamlink', 'twitchdownloader'] as const) {
      await ensureTool(id, (f, m) => { if (f === 0 || f > 0.99) console.log(m) })
      console.log(id, await toolVersion(id))
    }
  }
  if (!url) return
  const info = await inspectTwitch(url)
  console.log('INFO', JSON.stringify(info))
  if (arg === 'info') return
  const opts = arg?.includes('-') ? { section: arg.split('-').map(Number) as [number, number] } : { lastMinutes: Number(arg || 3) }
  const res = await importTwitch(url, opts, (p, m) => { if (Math.round(p * 100) % 20 === 0) console.log(`${Math.round(p * 100)} % ${m}`) })
  console.log('IMPORT', res.meta.title, res.meta.durationSec, 'twitch=', JSON.stringify(res.meta.twitch))
  console.log('PASS')
}
main().then(() => process.exit(0)).catch((e) => { console.error('FAIL', e instanceof Error ? e.message : e); process.exit(1) })
