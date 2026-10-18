/**
 * Stufen-Diagnose Sprecher-Tracking: je Clip ein Protokoll alle 0,5 s (TSV) + Debug-Video mit Overlays.
 * Stufen: A Gesichter → B Tracks → C ASD-Wert → D aktiver Sprecher → E geplanter Ausschnitt → F Ausschnitt vs. Gesichtsbox.
 * Markiert je Zeile die ERSTE Stufe, die auffällig ist (Heuristik – das Debug-Video entscheidet).
 *
 *   SHORTME_DATA=.tmp/fresh npx tsx --tsconfig tsconfig.node.json scripts/diag-tracking.ts <video> [clipId|start-end] [--no-video]
 */
import { execFile } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { promisify } from 'node:util'
import { importFile } from '../src/main/shortme/importer'
import { ensureShots, loadClips } from '../src/main/shortme/clips/analysis'
import { loadTranscript } from '../src/main/shortme/transcription'
import { analyzeClipASD, ASD_FPS } from '../src/main/pipeline/asd'
import { FFMPEG_PATH } from '../src/main/pipeline/ffmpeg'
import { layoutForClip } from '../src/main/shortme/layout/run'
import { activeSpeakers, cropWidth } from '../src/main/shortme/layout/plan'

const run = promisify(execFile)
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const noVideo = process.argv.includes('--no-video')
const OUT = '.tmp/diag'
const COLORS = ['00FF00', 'FF8000', 'FF00FF', '00FFFF', '0080FF', 'FFFF00'] // RRGGBB, in ASS BGR umgesetzt
const bgr = (rgb: string): string => rgb.slice(4, 6) + rgb.slice(2, 4) + rgb.slice(0, 2)
const f2 = (n: number): string => n.toFixed(2)
const ass = (t: number): string => { const h = Math.floor(t / 3600); const m = Math.floor((t % 3600) / 60); const s = t % 60; return `${h}:${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}` }

async function main(): Promise<void> {
  const video = args[0]
  const imp = await importFile(video)
  const meta = imp.meta
  const tr = await loadTranscript(meta.hash)
  const file = await loadClips(meta.hash)
  const cuts = await ensureShots(meta)
  let ranges: Array<{ id: string; start: number; end: number }> = file?.clips.map((c) => ({ id: c.id, start: c.start, end: c.end })) ?? []
  if (args[1]) {
    const m = /^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/.exec(args[1])
    ranges = m ? [{ id: `r${m[1]}`, start: +m[1], end: +m[2] }] : ranges.filter((r) => r.id === args[1])
  }
  await mkdir(OUT, { recursive: true })
  const W = meta.width, H = meta.height
  const tot = { rows: 0, A: 0, C: 0, D: 0, E: 0, F: 0 }
  for (const r of ranges) {
    const dur = r.end - r.start
    const an = await analyzeClipASD(meta.sourcePath, r.start, r.end)
    if (!an) { console.log(`${r.id}: keine ASD-Analyse`); continue }
    const lay = await layoutForClip(meta, r, cuts, undefined, an)
    const act = activeSpeakers(lay.input)
    const cw = cropWidth(W / H)
    const name = `${basename(video, '.mp4')}_${r.id}`
    const rows: string[] = ['t\tspeech\tA_faces(id:x1-x2,w/h)\tC_asd(id:score)\tD_active\tE_shot(layout,cx,track)\tF_crop\tF_inside\tFlag']
    const ev: string[] = []
    const speech = (t: number): boolean => (tr?.speech ?? []).some(([a, b]) => r.start + t >= a && r.start + t <= b)
    const trackAt = (f: number) => an.tracks.map((t, id) => ({ id, t, k: f - t.start })).filter((x) => x.k >= 0 && x.k < x.t.centres.length)
    const shotAt = (t: number) => lay.shots.find((s) => t >= s.start && t < s.end) ?? lay.shots[lay.shots.length - 1]
    const cropAt = (t: number): [number, number] => { const s = shotAt(t); const c = Math.min(1 - cw / 2, Math.max(cw / 2, s.cx)); return [c - cw / 2, c + cw / 2] }
    // Debug-Overlay alle 0,1 s
    for (let t = 0; t < dur; t += 0.1) {
      const f = Math.round(t * ASD_FPS)
      const tick = Math.min(lay.input.ticks - 1, Math.floor(t * 5))
      const sp = act[tick]
      const end = Math.min(dur, t + 0.1)
      for (const x of trackAt(f)) {
        const b = x.t.boxes?.[x.k]
        if (!b) continue
        const col = bgr(COLORS[x.id % COLORS.length])
        const bw = x.id === sp ? 6 : 2
        const [X1, Y1, X2, Y2] = [b.x1 * W, b.y1 * H, b.x2 * W, b.y2 * H].map(Math.round)
        ev.push(`Dialogue: 0,${ass(t)},${ass(end)},D,,0,0,0,,{\\pos(0,0)\\p1\\1a&HFF&\\3c&H${col}&\\bord${bw}}m ${X1} ${Y1} l ${X2} ${Y1} ${X2} ${Y2} ${X1} ${Y2}{\\p0}`)
        ev.push(`Dialogue: 1,${ass(t)},${ass(end)},D,,0,0,0,,{\\an7\\pos(${X1},${Math.max(0, Y1 - 36)})\\fs30\\bord2\\1c&H${col}&}T${x.id} ${f2(x.t.scores[x.k])}${x.id === sp ? ' *' : ''}`)
      }
      const [c0, c1] = cropAt(t)
      ev.push(`Dialogue: 0,${ass(t)},${ass(end)},D,,0,0,0,,{\\pos(0,0)\\p1\\1a&HFF&\\3c&H00FFFF&\\bord4}m ${Math.round(c0 * W)} 2 l ${Math.round(c1 * W)} 2 ${Math.round(c1 * W)} ${H - 2} ${Math.round(c0 * W)} ${H - 2}{\\p0}`)
    }
    // Protokoll alle 0,5 s
    for (let t = 0; t < dur; t += 0.5) {
      const f = Math.round(t * ASD_FPS)
      const tick = Math.min(lay.input.ticks - 1, Math.floor(t * 5))
      const tk = trackAt(f)
      const sp = act[tick]
      const s = shotAt(t)
      const [c0, c1] = cropAt(t)
      const score = (x: (typeof tk)[number]): number => { let sum = 0; let n = 0; for (let q = -5; q <= 5; q++) { const v = x.t.scores[x.k + q]; if (v !== undefined) { sum += v; n++ } } return n ? sum / n : -9 }
      const sc = tk.map((x) => ({ id: x.id, s: score(x) }))
      const faces = tk.map((x) => { const b = x.t.boxes?.[x.k]; return b ? `${x.id}:${f2(b.x1)}-${f2(b.x2)},${f2(((b.x2 - b.x1) * W) / ((b.y2 - b.y1) * H))}` : `${x.id}:?` }).join(' ')
      const spk = speech(t)
      const target = sp === null ? undefined : tk.find((x) => x.id === sp)
      const tb = target?.t.boxes?.[target.k]
      const ov = (lo: number, hi: number): number => (tb ? Math.max(0, Math.min(hi, tb.x2) - Math.max(lo, tb.x1)) / (tb.x2 - tb.x1) : NaN)
      // Split: zwei Hälften (je halbe Ausschnittsbreite um cx bzw. cx2 bei Zoom 1) – Gesicht muss in einer ganz sein
      const half = s.layout === 'split' ? Math.max(ov(s.cx - 0.5 * cw / s.zoom, s.cx + 0.5 * cw / s.zoom), s.cx2 !== undefined ? ov(s.cx2 - 0.5 * cw / s.zoom, s.cx2 + 0.5 * cw / s.zoom) : 0) : NaN
      const inside = s.layout === 'split' ? half : ov(c0, c1)
      const best = sc.length ? sc.reduce((a, b) => (b.s > a.s ? b : a)) : null
      let flag = ''
      if (spk && tk.length === 0) { flag = 'A:Sprache ohne Gesicht'; tot.A++ }
      else if (spk && sc.length && sc.every((x) => x.s < 0)) { flag = 'C:Sprache, alle ASD<0'; tot.C++ }
      else if (spk && sp !== null && best && best.id !== sp && best.s > 0.5 && (sc.find((x) => x.id === sp)?.s ?? -9) < best.s - 0.5) { flag = `D:aktiv T${sp} aber T${best.id} spricht lauter`; tot.D++ }
      else if (s.layout === 'fit' && tk.length > 0 && spk) { flag = 'E:Fit trotz Gesicht'; tot.E++ }
      else if (!Number.isNaN(inside) && inside < 0.9) { flag = `F:Gesicht nur ${(inside * 100).toFixed(0)} % im Ausschnitt`; tot.F++ }
      tot.rows++
      rows.push([f2(t), spk ? 'ja' : '-', faces || '-', sc.map((x) => `${x.id}:${f2(x.s)}`).join(' ') || '-', sp === null ? '-' : `T${sp}`, `${s.layout},${f2(s.cx)},${s.track ?? '-'}`, `${f2(c0)}-${f2(c1)}`, Number.isNaN(inside) ? '-' : f2(inside), flag].join('\t'))
    }
    await writeFile(join(OUT, `${name}.tsv`), rows.join('\n'), 'utf8')
    console.log(`${name}: ${dur.toFixed(0)} s, ${an.tracks.length} Tracks, Protokoll ${OUT}/${name}.tsv`)
    if (!noVideo) {
      const header = `[Script Info]\nScriptType: v4.00+\nPlayResX: ${W}\nPlayResY: ${H}\n\n[V4+ Styles]\nFormat: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding\nStyle: D,Arial,30,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,2,0,7,0,0,0,1\n\n[Events]\nFormat: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text\n`
      await writeFile(join(OUT, `${name}.ass`), header + ev.join('\n'), 'utf8')
      await run(FFMPEG_PATH, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(r.start), '-t', String(dur), '-i', meta.sourcePath, '-vf', `ass=${name}.ass,scale=960:-2`, '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', `${name}.debug.mp4`], { cwd: OUT, maxBuffer: 1 << 26 })
      console.log(`  Debug-Video ${OUT}/${name}.debug.mp4 (Farbe = Track, dick = aktiver Sprecher, gelb = 9:16-Ausschnitt)`)
    }
  }
  console.log(`ZUSAMMENFASSUNG ${tot.rows} Zeilen, erste auffällige Stufe: A ${tot.A} · C ${tot.C} · D ${tot.D} · E ${tot.E} · F ${tot.F}`)
  process.exit(0)
}

main().catch((e) => { console.error('FAIL', e); process.exit(1) })
