// Messung: Qwen3.5 über mlx_vlm.server mit/ohne Prefix-Cache (APC). Gleicher langer Regelteil, wechselnder Kandidatenteil, 3 Anfragen.
// Aufruf: node scripts/mac2-apc-bench.mjs <modellordner> <0|1>
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { join } from 'node:path'

const [model, apc] = process.argv.slice(2)
const py = join(process.env.HOME, 'Library/Application Support/cutawan/runtime/py312-macav/bin/python')
const port = await new Promise((r) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)) }) })
const srv = spawn(py, ['-I', '-m', 'mlx_vlm.server', '--model', model, '--host', '127.0.0.1', '--port', String(port), '--max-tokens', '2048'], { stdio: 'ignore', env: { ...process.env, HF_HUB_OFFLINE: '1', APC_ENABLED: apc, APC_DISK_ENABLED: '0' } })
const post = (body) => fetch(`http://127.0.0.1:${port}/v1/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, chat_template_kwargs: { enable_thinking: false }, ...body }) })
for (;;) { try { if ((await post({ messages: [{ role: 'user', content: 'ok' }], max_tokens: 1 })).ok) break } catch { /* lädt */ } await new Promise((r) => setTimeout(r, 750)) }
const rules = Array.from({ length: 60 }, (_, i) => `Regel ${i + 1}: Der Clip muss eigenständig verständlich sein, mit klarem Anfang, Pointe und natürlichem Ende; keine erfundenen Zeiten oder Titel.`).join('\n')
const schema = { type: 'object', additionalProperties: false, required: ['title', 'summary'], properties: { title: { type: 'string', maxLength: 60 }, summary: { type: 'string', maxLength: 120 } } }
for (let k = 1; k <= 3; k++) {
  const data = Array.from({ length: 40 }, (_, i) => `S${k * 100 + i} ${(k * 60 + i * 2).toFixed(1)}s: Das ist Satz ${i} von Kandidat ${k}, der Döner ist ${i % 2 ? 'trocken' : 'saftig'} und kostet ${7 + (i % 3)} Euro.`).join('\n')
  const t0 = Date.now()
  const r = await (await post({ messages: [{ role: 'user', content: `${rules}\n--- Kandidat ---\n${data}` }], max_tokens: 120, temperature: 0, response_format: { type: 'json_schema', json_schema: { name: 'a', strict: true, schema } } })).json()
  console.log(`APC=${apc} Anfrage ${k}: ${((Date.now() - t0) / 1000).toFixed(1)} s, prompt ${r.usage?.prompt_tokens}, cached ${r.usage?.prompt_tokens_details?.cached_tokens}, out ${r.usage?.completion_tokens}`)
}
srv.kill('SIGKILL')
process.exit(0)
