// Stapel-Lauf für die Qualitätsmessung in der LAUFENDEN App (CDP): jedes Werkbank-Video mit Creator-Shorts durch Engine 1–4,
// gleiche Anzahl Clips (k), Profil Ausgewogen. Fehlt die Quelldatei (Werkbank löscht Videos nach der Auswertung), wird sie neu geladen.
// Schon vorhandene fertige Läufe mit ≥ k Clips werden übersprungen (Fortsetzen nach Abbruch).
//   App starten mit: Shortme.exe --remote-debugging-port=9333
//   node scripts/quality-batch.cjs [port=9333] [k=10] [engines=legacy,multimodal-v2,adaptive-v3,engine4]
const fs = require('fs'), path = require('path')
const [port = '9333', kArg = '10', engArg = 'legacy,multimodal-v2,adaptive-v3,engine4'] = process.argv.slice(2)
const K = Number(kArg), ENGINES = engArg.split(',')
const PROJ = path.join(process.env.SHORTME_DATA ?? path.join(process.env.APPDATA ?? '', 'cutawan'), 'projects')
const read = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return null } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function cdp() {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
  const page = targets.find((t) => t.type === 'page' && !/captions\.html/.test(t.url)) ?? targets[0]
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((r) => (ws.onopen = r))
  let id = 0
  const pending = new Map()
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id) } }
  return async (expr) => {
    const i = ++id
    const r = await new Promise((res) => { pending.set(i, res); ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression: `(async()=>{${expr}})()`, awaitPromise: true, returnByValue: true } })) })
    if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text)
    return r.result.result.value
  }
}

/** Fertiger Lauf dieser Engine mit mindestens K Clips vorhanden? (Engine 1: clips.json im Projekt mit gleicher Anzahl) */
function hasRun(hash, engine) {
  if (engine === 'legacy') { const c = read(path.join(PROJ, hash, 'clips.json')); return !!c && (!c.engine || c.engine === 'legacy') && c.clips.length >= K }
  const st = read(path.join(PROJ, hash, 'analysis', 'state.json'))
  return (st?.runs ?? []).some((r) => r.engineId === engine && r.status === 'done' && (r.clipCount ?? 0) >= Math.min(K, 4))
}

;(async () => {
  const ev = await cdp()
  const items = (await ev('return await window.cutawan.shortme.learn.wbList()')).filter((x) => x.hash && x.shorts > 0 && x.status === 'evaluated')
  console.log(`${items.length} Videos mit Creator-Shorts`)
  for (const it of items) {
    for (const engine of ENGINES) {
      if (hasRun(it.hash, engine)) { console.log(`= ${it.title.slice(0, 40)} · ${engine}: vorhanden`); continue }
      const meta = read(path.join(PROJ, it.hash, 'project.json'))
      if (!meta || !fs.existsSync(meta.sourcePath)) { console.log(`  lade ${it.url} neu …`); await ev(`await window.cutawan.shortme.importUrl(${JSON.stringify(it.url)}); return 1`) }
      const t0 = Date.now()
      const job = await ev(`return await window.cutawan.shortme.transcribe(${JSON.stringify(it.hash)}, { engine: ${JSON.stringify(engine)}, profile: 'balanced', wanted: ${K}, contentType: 'auto' })`)
      let j = job
      while (!['done', 'error', 'stopped'].includes(j.state)) { await sleep(20_000); j = (await ev('return await window.cutawan.shortme.jobs()')).find((x) => x.id === job.id) ?? { state: 'error', error: 'Job verschwunden' } }
      console.log(`${j.state === 'done' ? '+' : '!'} ${it.title.slice(0, 40)} · ${engine}: ${j.state} in ${Math.round((Date.now() - t0) / 60000)} min ${j.error ?? ''}`)
    }
  }
  console.log('FERTIG')
  process.exit(0)
})().catch((e) => { console.error('FEHLER', e.message); process.exit(1) })
