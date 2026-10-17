// M0.3 LLM-Spike: node spikes/llm.cjs <gguf-dateiname> [runs]
const { spawn } = require('child_process')
const fs = require('fs'), path = require('path')
const root = path.join(__dirname, '..')
const model = process.argv[2], runs = Number(process.argv[3] || 5)
const port = 8089
const segs = JSON.parse(fs.readFileSync(path.join(__dirname, 'out', 'asr-parakeet.json')))
const total = Math.ceil(segs[segs.length - 1].end)
const transcript = segs.map((s) => `[${s.start.toFixed(1)}] ${s.text.trim()}`).join('\n')
const schema = {
  type: 'object', additionalProperties: false, required: ['clips'],
  properties: { clips: { type: 'array', minItems: 3, maxItems: 3, items: {
    type: 'object', additionalProperties: false,
    required: ['start', 'end', 'title', 'hook', 'score', 'reason'],
    properties: { start: { type: 'number' }, end: { type: 'number' }, title: { type: 'string' }, hook: { type: 'string' }, score: { type: 'integer', minimum: 0, maximum: 100 }, reason: { type: 'string' } } } } }
}
const sys = 'Du bist Redakteur für Kurzvideos (TikTok/Reels). Wähle aus dem deutschen Transkript genau 3 in sich geschlossene, ohne Vorwissen verständliche Clips (Hook → Aufbau → Pointe), je 20–60 Sekunden. start/end in Sekunden, passend zu den Zeitmarken. Titel und Hook-Text auf Deutsch. Antworte nur mit JSON.'
const user = `Transkript (Zeitmarke in Sekunden, Gesamtlänge ${total}s):\n${transcript}`

;(async () => {
  const srv = spawn(path.join(root, 'models/llama/llama-server.exe'), ['-m', path.join(root, 'models/llama', model), '-c', '16384', '-ngl', '99', '-fa', 'on', '--port', String(port), '--jinja'], { stdio: ['ignore', 'pipe', 'pipe'] })
  let log = ''; srv.stderr.on('data', (d) => (log += d)); srv.stdout.on('data', (d) => (log += d))
  const t0 = Date.now()
  for (;;) {
    if (srv.exitCode !== null) { console.log('LLM server exit', log.slice(-800)); process.exit(1) }
    try { const r = await fetch(`http://127.0.0.1:${port}/health`); if (r.ok) break } catch {}
    await new Promise((r) => setTimeout(r, 500))
  }
  const loadS = (Date.now() - t0) / 1000
  const vram = (() => { try { return require('child_process').execSync('nvidia-smi --query-gpu=memory.used --format=csv,noheader').toString().trim() } catch { return '?' } })()
  let valid = 0, plausible = 0; const times = []; const outs = []
  for (let i = 0; i < runs; i++) {
    const t = Date.now()
    const res = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
      messages: [{ role: 'system', content: sys }, { role: 'user', content: user }], temperature: 0.4, max_tokens: 1500,
      chat_template_kwargs: { enable_thinking: false },
      response_format: { type: 'json_schema', json_schema: { name: 'clips', strict: true, schema } } }) })
    const j = await res.json(); const dt = (Date.now() - t) / 1000; times.push(dt)
    try {
      const o = JSON.parse(j.choices[0].message.content)
      const ok = Array.isArray(o.clips) && o.clips.length === 3 && o.clips.every((c) => c.title && c.hook && c.end > c.start)
      if (ok) valid++
      if (ok && o.clips.every((c) => c.start >= 0 && c.end <= total + 1 && c.end - c.start >= 15 && c.end - c.start <= 90)) plausible++
      outs.push({ run: i, sec: dt, tokens: j.usage?.completion_tokens, out: o })
    } catch (e) { outs.push({ run: i, sec: dt, error: String(e), raw: j.choices?.[0]?.message?.content?.slice(0, 200) }) }
  }
  fs.writeFileSync(path.join(__dirname, 'out', `llm-${model}.json`), JSON.stringify({ prompt_tokens: null, outs }, null, 1))
  console.log(`LLM ${model} load=${loadS.toFixed(0)}s vram=${vram} validJSON=${valid}/${runs} plausibleRange=${plausible}/${runs} avg=${(times.reduce((a, b) => a + b, 0) / runs).toFixed(1)}s`)
  srv.kill()
  setTimeout(() => process.exit(0), 500)
})()
