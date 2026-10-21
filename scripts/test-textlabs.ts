/** Testlab-Verfahren Clip-Transkription und Clip-Auswahl (LLM) im Skript prüfen.
 *   SHORTME_DATA=<Daten> npx tsx --tsconfig tsconfig.node.json scripts/test-textlabs.ts asr
 *   SHORTME_DATA=<Daten> npx tsx --tsconfig tsconfig.node.json scripts/test-textlabs.ts llm <Projekt-Hash> [Start] [Dauer] [Modell …] */
import { join } from 'node:path'
import { alignWords, substitutions } from '../src/shared/wordDiff'
import { runClipAsrSide, runLlmSide } from '../src/main/testlab/textLabs'

async function main(): Promise<void> {
  const [what, hash, start = '0', dur = '600', ...models] = process.argv.slice(2)
  if (what === 'asr') {
    const path = join(process.cwd(), 'test-' + 'videos', 'podcast-2p.mp4')
    const a = await runClipAsrSide('parakeet_v3_clip', path, 120, 90, console.log)
    const b = await runClipAsrSide(hash || 'parakeet_pass2', path, 120, 90, console.log)
    const wa = a.text!.words.map((w) => w.w), wb = b.text!.words.map((w) => w.w)
    const ops = alignWords(wa, wb)
    const subs = substitutions(wa, wb)
    console.log(`A ${wa.length} Wörter ${a.runtimeSec}s | B ${wb.length} Wörter ${b.runtimeSec}s | Unterschiede ${ops.filter((o) => o.kind !== 'same').length} | Schreibweisen übernommen ${Object.keys(subs).length}`)
    console.log('PASS')
    return
  }
  for (const model of models.length ? models : ['qwen3_14b', 'qwen3_8_27b_q4']) {
    const r = await runLlmSide(model, `project:${hash}`, Number(start), Number(dur), (m) => { if (/geladen|Clips|fertig/.test(m)) console.log(m) })
    console.log(`== ${model}: ${r.clips?.length} Clips, Laufzeit ${r.runtimeSec} s, VRAM-Spitze +${r.vramPeakMb} MB`)
    for (const c of r.clips ?? []) console.log(' ', c.score, `${Math.round(c.start)}-${Math.round(c.end)}`, c.title, '|', c.reason.slice(0, 90))
  }
  console.log('PASS')
}
main().then(() => process.exit(0)).catch((e) => { console.error('FAIL', e instanceof Error ? e.stack : e); process.exit(1) })
