/** LEER-Diagnose Schritt 4: gespeicherte Plan-Eingabe eines Clips neu planen und Zwischenwerte ausgeben.
 *   SHORTME_DATA=<Daten> npx tsx --tsconfig tsconfig.node.json scripts/leer-plan.ts <hash> <clipId> [von] [bis] */
import { loadLayoutInput } from '../src/main/shortme/clips/analysis'
import { loadClips } from '../src/main/shortme/clips/analysis'
import { activeSpeakers, planShots, PLAN_DEFAULTS } from '../src/shared/layoutPlan'

async function main(): Promise<void> {
  const [hash, id, a = '0', b = '1e9'] = process.argv.slice(2)
  const clip = (await loadClips(hash))!.clips.find((c) => c.id === id)!
  const inp = (await loadLayoutInput(hash, id))!
  console.log(`Clip ${id} ${clip.start}-${clip.end}; Ticks ${inp.ticks} @${inp.dt}s; Spuren ${inp.tracks.length}; Schnitte(Ticks) ${inp.cuts.length}; Quell-Aspect ${inp.sourceAspect.toFixed(3)}`)
  const act = activeSpeakers(inp, PLAN_DEFAULTS)
  const rel0 = Number(a) - clip.start, rel1 = Number(b) - clip.start
  let last: number | null | undefined
  for (let i = 0; i < act.length; i++) {
    const t = i * inp.dt
    if (t < rel0 || t > rel1) continue
    if (act[i] !== last) { last = act[i]; const tk = inp.tracks.find((x) => x.id === act[i]); console.log(`  t=${(clip.start + t).toFixed(1)} aktiv=${act[i]} ${tk ? 'cx=' + tk.centres[Math.min(tk.centres.length - 1, Math.max(0, i - tk.start))].toFixed(2) : ''}`) }
  }
  const shots = planShots(inp, PLAN_DEFAULTS)
  console.log('Neu geplant:', shots.map((s) => `${(clip.start + s.start).toFixed(1)}-${(clip.start + s.end).toFixed(1)} ${s.layout} cx=${s.cx.toFixed(2)}${s.cx2 !== undefined ? '/' + s.cx2.toFixed(2) : ''}`).slice(0, 40).join(' | '))
  console.log('Gespeichert:', (clip.shots ?? []).map((s) => `${(clip.start + s.start).toFixed(1)}-${(clip.start + s.end).toFixed(1)} ${s.layout} cx=${s.cx.toFixed(2)}`).join(' | '))
  const spk = (tid: number): string => { const t = inp.tracks.find((x) => x.id === tid)!; const s = t.scores.filter((v) => v > 0).length / t.scores.length; return `#${tid} start ${(clip.start + t.start * inp.dt).toFixed(1)} len ${(t.centres.length * inp.dt).toFixed(1)}s cx ${(t.centres.reduce((x, y) => x + y, 0) / t.centres.length).toFixed(2)} fläche ${(t.areas.reduce((x, y) => x + y, 0) / t.areas.length * 100).toFixed(1)}% sprechend ${(s * 100).toFixed(0)}%` }
  for (const t of inp.tracks.slice(0, 14)) console.log('  ', spk(t.id))
}
main().then(() => process.exit(0)).catch((e) => { console.error('FAIL', e instanceof Error ? e.stack : e); process.exit(1) })
