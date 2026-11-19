/* global setTimeout */
// Rauchtest Engine Mac 2: startet mlx_vlm.server mit einem Modell und schickt eine Anfrage mit erzwungenem JSON-Schema.
// Aufruf: node scripts/mac2-smoke.mjs <modellordner> <ffmpeg> <video> <start> <dauer> [text]
//   Bilder (8, gleichmäßig) + Ton (separat, 16 kHz mono) aus dem Ausschnitt → Beobachtung je 10-s-Segment. Mit „text“: nur Textanfrage.
import { spawn, execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:net'

const [model, ffmpeg, video, start, dur, mode] = process.argv.slice(2)
const py = join(process.env.HOME, 'Library/Application Support/cutawan/runtime/py312-macav/bin/python')
const port = await new Promise((r) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)) }) })
const t0 = Date.now()
const srv = spawn(py, ['-I', '-m', 'mlx_vlm.server', '--model', model, '--host', '127.0.0.1', '--port', String(port), '--max-tokens', '2048'], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, HF_HUB_OFFLINE: '1' } })
let tail = ''; srv.stderr.on('data', (d) => { tail = (tail + d).slice(-2000) }); srv.stdout.on('data', (d) => { tail = (tail + d).slice(-2000) })
const url = `http://127.0.0.1:${port}/v1/chat/completions`
const post = (body) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, chat_template_kwargs: { enable_thinking: false }, ...body }) })
for (;;) { if (srv.exitCode !== null) { console.log('SERVER TOT', tail); process.exit(1) } try { if ((await post({ messages: [{ role: 'user', content: 'ok' }], max_tokens: 1 })).ok) break } catch { /* noch nicht bereit */ } await new Promise((r) => setTimeout(r, 750)) }
console.log('LOAD', ((Date.now() - t0) / 1000).toFixed(1), 's')
const segs = ['S1', 'S2', 'S3']
const schema = { type: 'object', additionalProperties: false, required: ['segments'], properties: { segments: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'object', additionalProperties: false, required: ['id', 'visual', 'audio', 'speech'], properties: { id: { type: 'string', enum: segs }, visual: { type: 'string' }, audio: { type: 'string' }, speech: { type: 'string' } } } } } }
let content
if (mode === 'text') content = 'Fasse in einem Satz zusammen: „Das Brot ist außen sehr kross, innen aber zu trocken.“ Antworte als JSON mit segments S1–S3 (visual/audio/speech leer lassen außer speech von S1).'
else {
  const d = mkdtempSync(join(tmpdir(), 'mac2-'))
  const frames = []
  for (let i = 0; i < 8; i++) { const t = Number(start) + (Number(dur) * (i + 0.5)) / 8; const f = join(d, `f${i}.jpg`); execFileSync(ffmpeg, ['-v', 'error', '-ss', t.toFixed(2), '-i', video, '-frames:v', '1', '-vf', 'scale=448:-2', '-q:v', '3', f]); frames.push({ f, t: t - Number(start) }) }
  const wav = join(d, 'a.wav'); execFileSync(ffmpeg, ['-v', 'error', '-ss', start, '-t', dur, '-i', video, '-vn', '-ac', '1', '-ar', '16000', wav])
  content = [{ type: 'text', text: `You get 8 frames (at seconds ${frames.map((x) => x.t.toFixed(1)).join(', ')}) and the full audio of a ${dur}-second excerpt. Segments: S1 = 0–10 s, S2 = 10–20 s, S3 = 20–30 s.` }, ...frames.map((x) => ({ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + readFileSync(x.f).toString('base64') } })), { type: 'input_audio', input_audio: { data: 'data:audio/wav;base64,' + readFileSync(wav).toString('base64'), format: 'wav' } }, { type: 'text', text: 'For each segment describe briefly what is visible, what sounds are audible, and what is said (quote a few words in the original language). Only what you actually see and hear.' }]
}
const t1 = Date.now()
const r = await post({ messages: [{ role: 'system', content: 'Answer questions about the provided images and audio. Base every answer only on what can be seen and heard. Respond with text.' }, { role: 'user', content }], temperature: 0, max_tokens: 700, response_format: { type: 'json_schema', json_schema: { name: 'answer', strict: true, schema } } })
const body = await r.text()
console.log('HTTP', r.status, ((Date.now() - t1) / 1000).toFixed(1), 's')
try { const j = JSON.parse(body); console.log(j.choices[0].message.content); console.log('usage', JSON.stringify(j.usage)) } catch { console.log(body.slice(0, 800)) }
try { console.log('RSS server', execFileSync('ps', ['-o', 'rss=', '-p', String(srv.pid)]).toString().trim(), 'KB') } catch { /* Prozess schon weg */ }
srv.kill('SIGKILL')
process.exit(0)
