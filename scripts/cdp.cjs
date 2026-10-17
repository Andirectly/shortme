// Mini-CDP-Client für Abnahmetests im echten Electron-Fenster (Node ≥ 22, eingebautes WebSocket).
//   node scripts/cdp.cjs <port> eval "<js-ausdruck>"         → Ergebnis als JSON
//   node scripts/cdp.cjs <port> shot <datei.png>             → Screenshot
const fs = require('fs')
const [port, cmd, arg] = process.argv.slice(2)
;(async () => {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
  const page = targets.find((t) => t.type === 'page' && !/captions\.html/.test(t.url)) ?? targets[0]
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((r) => (ws.onopen = r))
  let id = 0
  const pending = new Map()
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id) } }
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })) })
  if (cmd === 'eval') {
    const r = await send('Runtime.evaluate', { expression: `(async()=>{${arg}})()`, awaitPromise: true, returnByValue: true })
    console.log(JSON.stringify(r.result.exceptionDetails ? { error: r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text } : r.result.result.value))
  } else if (cmd === 'shot') {
    const r = await send('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(arg, Buffer.from(r.result.data, 'base64'))
    console.log('ok', arg)
  }
  ws.close()
  process.exit(0)
})().catch((e) => { console.error('FAIL', e.message); process.exit(1) })
