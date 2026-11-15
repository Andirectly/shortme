/** Lädt/prüft das Embedding-Modell von Engine 3 über den Modell-Manager (Prüfsummen laut Katalog). */
import { assets } from '../src/main/engines'
let last = 0
assets.on('status', (s) => { if (s.id === 'qwen3-vl-embedding-2b' && (s.state !== 'downloading' || Date.now() - last > 15000)) { last = Date.now(); console.log(`  ${s.id} ${s.state} ${(s.progress * 100).toFixed(0)}%`) } })
void assets.install('qwen3-vl-embedding-2b').then(() => { console.log('installiert'); process.exit(0) }).catch((e) => { console.error('FEHLER', e); process.exit(1) })
