/** Installiert/repariert die gemanagte Python-Laufzeit von Engine 3 (wie der Modell-Manager es tut) und gibt den Status aus. */
import { installRuntime, runtimeStatus } from '../src/main/shortme/clips/engines/v3/runtime'
void (async () => {
  console.log('vorher:', JSON.stringify(await runtimeStatus()))
  const s = await installRuntime((l) => console.log('  ' + l.slice(0, 140)))
  console.log('nachher:', JSON.stringify(s))
  process.exit(s.state === 'ready' ? 0 : 1)
})().catch((e) => { console.error('FEHLER', e); process.exit(1) })
