/**
 * M2-Abnahme: frische Installation (leerer Datenordner) → Modelle laden → Systemcheck →
 * ASR + LLM exklusiv über die VRAM-Sequenzierung → alle Kindprozesse beenden.
 *
 *   SHORTME_DATA=.tmp/fresh npx tsx --tsconfig tsconfig.node.json scripts/test-engines.ts [wav]
 */
import { execFileSync } from 'node:child_process'
import { assets, hardware, systemCheck, withAsr, withLlm, llama } from '../src/main/engines'
import { killAllSidecars, liveSidecars } from '../src/main/engines/sidecars'
import { transcribeWav } from '../src/main/engines/asr/client'
import { ensureYtDlp } from '../src/main/pipeline/ytdlp'

const wav = process.argv[2] ?? 'spikes/out/podcast.wav'
const procs = (): string[] => {
  try {
    const out = execFileSync('tasklist', ['/FO', 'CSV', '/NH'], { encoding: 'utf8' })
    return out.split('\n').filter((l) => /llama-server/i.test(l))
  } catch { return [] }
}

async function main(): Promise<void> {
  const hw = await hardware()
  console.log(`HW ${hw.gpuName} ${hw.vramTotalMb}MB profile=${hw.profile} llm=${hw.recommendedLlm} kvQuant=${hw.kvQuant}`)

  let last = 0
  assets.on('status', (s) => { if (s.state !== 'downloading' || Date.now() - last > 15000) { last = Date.now(); console.log(`  ${s.id} ${s.state} ${(s.progress * 100).toFixed(0)}%${s.error ? ' ' + s.error : ''}`) } })
  const ids = ['silero-vad', 'transnetv2', 'llama-server', 'node-runtime', 'speaker-segmentation', 'speaker-embedding', 'parakeet-v3', hw.recommendedLlm]
  const t0 = Date.now()
  for (const id of ids) await assets.install(id)
  await ensureYtDlp(() => undefined)
  console.log(`INSTALL ok in ${((Date.now() - t0) / 1000).toFixed(0)}s`)

  const check = await systemCheck()
  for (const c of check) console.log(`CHECK ${c.ok ? 'OK ' : 'FAIL'} ${c.name}: ${c.detail}`)

  const asr = await withAsr(() => transcribeWav(wav, { maxSeconds: 60 }))
  const words = asr.segments.reduce((n, s) => n + s.words.length, 0)
  console.log(`ASR segs=${asr.segments.length} words=${words} load=${asr.loadMs}ms decode=${asr.decodeMs}ms for ${asr.audioSec.toFixed(0)}s`)

  const text = asr.segments.map((s) => s.text).join(' ').slice(0, 1500)
  const reply = await withLlm(async (url) => {
    const r = await fetch(`${url}/v1/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: `Fasse in einem Satz zusammen: ${text}` }], max_tokens: 80, chat_template_kwargs: { enable_thinking: false } }) })
    return ((await r.json()) as { choices: { message: { content: string } }[] }).choices[0].message.content
  })
  console.log(`LLM running=${llama.running} reply="${reply.trim().slice(0, 120)}"`)
  console.log(`before shutdown: sidecars=${liveSidecars().join(',')} llama-procs=${procs().length}`)

  await killAllSidecars()
  await new Promise((r) => setTimeout(r, 1000))
  const left = procs().length
  console.log(`after shutdown: sidecars=${liveSidecars().length} llama-procs=${left}`)
  const failed = check.filter((c) => !c.ok).length
  console.log(failed === 0 && left === 0 ? 'PASS' : `FAIL (checks failed=${failed}, leftover=${left})`)
  process.exit(failed === 0 && left === 0 ? 0 : 1)
}

main().catch(async (e) => { console.error('FAIL', e); await killAllSidecars(); process.exit(1) })
