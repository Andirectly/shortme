/** Testlab-Verfahren Clip-Transkription und Clip-Auswahl (LLM) im Skript prüfen.
 *   SHORTME_DATA=<Daten> npx tsx --tsconfig tsconfig.node.json scripts/test-textlabs.ts asr|llm [Projekt-Hash] */
import { join } from 'node:path'
import { alignWords, substitutions } from '../src/shared/wordDiff'
import { runClipAsrSide, runLlmSide } from '../src/main/testlab/textLabs'

async function main(): Promise<void> {
  const [what, hash] = process.argv.slice(2)
  if (what === 'asr') {
    const path = join(process.cwd(), 'test-' + 'videos', 'podcast-2p.mp4')
    const a = await runClipAsrSide('parakeet_v3_clip', path, 120, 90, console.log)
    const b = await runClipAsrSide('parakeet_pass2', path, 120, 90, console.log)
    const wa = a.text!.words.map((w) => w.w), wb = b.text!.words.map((w) => w.w)
    const ops = alignWords(wa, wb)
    const subs = substitutions(wa, wb)
    console.log(`A ${wa.length} Wörter ${a.runtimeSec}s | B ${wb.length} Wörter ${b.runtimeSec}s | Unterschiede ${ops.filter((o) => o.kind !== 'same').length} (sub ${ops.filter((o) => o.kind === 'sub').length}, ins ${ops.filter((o) => o.kind === 'ins').length}, del ${ops.filter((o) => o.kind === 'del').length}) | Schreibweisen übernommen ${Object.keys(subs).length}`)
    for (const [i, t] of Object.entries(subs).slice(0, 8)) console.log(`  ${wa[+i]} → ${t}`)
    console.log('PASS')
  } else {
    const r = await runLlmSide('qwen3_14b', `project:${hash}`, 0, 600, console.log)
    console.log('Clips', r.clips?.length, 'Laufzeit', r.runtimeSec, 'VRAM', r.vramPeakMb)
    for (const c of r.clips ?? []) console.log(' ', c.score, c.title, '|', c.reason.slice(0, 80))
    console.log('PASS')
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error('FAIL', e instanceof Error ? e.stack : e); process.exit(1) })
