/**
 * Prüfstand „Most replayed“ (Methode wie Rhapsody): Wie viele unserer Clips liegen auf Spitzen der Replay-Kurve?
 * Für jedes Projekt mit heatmap.json + clips.json:
 *  - Treffer: Clip enthält (±3 s) eine Spitze (lokales Maximum ≥ 0,75)
 *  - Lift: mittlere Kurvenstärke der Clips ÷ Durchschnitt der ganzen Kurve (> 1 = Clips liegen auf beliebteren Stellen)
 *  - Zufallsbasis: Trefferquote zufälliger Fenster gleicher Länge (200 Ziehungen)
 *   SHORTME_DATA=.tmp/fresh npx tsx --tsconfig tsconfig.node.json scripts/eval-heat.ts [projektHash...]
 */
import { readdir } from 'node:fs/promises'
import { loadClips } from '../src/main/shortme/clips/analysis'
import { heatPeaks, heatScore, heatStats, loadHeat } from '../src/main/shortme/clips/heat'
import { loadMeta, projectsRoot } from '../src/main/shortme/project'

async function main(): Promise<void> {
  const hashes = process.argv.length > 2 ? process.argv.slice(2) : await readdir(projectsRoot())
  let n = 0
  for (const h of hashes) {
    const heat = await loadHeat(h)
    const file = await loadClips(h)
    if (!heat || !file?.clips.length) continue
    n++
    const meta = await loadMeta(h)
    const dur = heat[heat.length - 1].end
    const peaks = heatPeaks(heat)
    const hits = (a: number, b: number): boolean => peaks.some((p) => (p.start + p.end) / 2 >= a - 3 && (p.start + p.end) / 2 <= b + 3)
    const clipHits = file.clips.filter((c) => hits(c.start, c.end)).length
    let rnd = 0, rndN = 0
    for (let i = 0; i < 200; i++) for (const c of file.clips) { const len = c.end - c.start; const a = Math.random() * Math.max(1, dur - len); rndN++; if (hits(a, a + len)) rnd++ }
    const whole = heatStats(heat, 0, dur).mean
    const mean = file.clips.reduce((s, c) => s + heatScore(heat, c.start, c.end), 0) / file.clips.length
    const lift = file.clips.reduce((s, c) => s + heatStats(heat, c.start, c.end).mean, 0) / file.clips.length / Math.max(1e-6, whole)
    console.log(`${meta?.title ?? h}: ${file.clips.length} Clips, ${peaks.length} Spitzen · Treffer ${clipHits}/${file.clips.length} (${Math.round((100 * clipHits) / file.clips.length)} %) vs. Zufall ${Math.round((100 * rnd) / rndN)} % · Lift ${lift.toFixed(2)} · Ø Stärke ${mean.toFixed(2)}`)
  }
  console.log(n ? 'PASS (Auswertung)' : 'Keine Projekte mit Heatmap (nur YouTube-Importe haben eine)')
  process.exit(0)
}
main().catch((e) => { console.error('FAIL', e); process.exit(1) })
