import type { ShortmeShot } from './shortme'

// Shot-Planer (docs/PIPELINE.md §6): reine Funktionen, keine Kamerabewegung innerhalb eines Shots.
// Eingabe sind Gesichts-Tracks mit ASD-Werten (Logits, > 0 = spricht) auf einem festen Zeitraster.

export interface PlanTrack {
  id: number
  /** Erster Tick (Raster `dt`) relativ zum Clipbeginn. */
  start: number
  centres: number[] // 0..1 horizontale Gesichtsmitte
  areas: number[] // normalisierte Boxfläche
  scores: number[] // ASD-Logit je Tick
  /** Person des ganzen Videos (Wiedererkennung über Schnitte), falls bekannt. */
  person?: string
}

export interface PlanInput {
  tracks: PlanTrack[]
  ticks: number
  dt: number
  /** Kamerawechsel als Tick-Indizes (Shot-Grenzen). */
  cuts: number[]
  /** Seitenverhältnis der Quelle (Breite/Höhe), z. B. 16/9. */
  sourceAspect: number
  targetAspect?: number
  /** Sprache je Tick (VAD). Ohne Angabe gilt jeder Tick als Sprache. Gewechselt wird nur während Sprache. */
  speech?: boolean[]
  /** Rollen aus dem „Wer ist wer?“-Dialog: `ignore` wird nie zum Ziel, `main` gewinnt bei unklarem ASD. */
  personRoles?: Record<string, 'main' | 'ignore'>
}

export interface PlanOptions {
  switchRatio: number
  minSpeakSec: number
  ignoreAreaRatio: number
  moveLimit: number
  noSpeakerSec: number
  minShotSec: number
  pingPongSwitches: number
  pingPongWindowSec: number
  /** Gesichtsfläche (Anteil am Bild), unter der die Person als „zu weit weg“ gilt → ganzes Bild statt Tracking. */
  wideFaceArea?: number
  /** Ab so vielen sichtbaren Personen, die nicht in einen 9:16-Ausschnitt passen, zeigt der Planer das ganze Bild. */
  groupMinPersons?: number
  /** Inhaltstyp-Profil: Split bei zwei Personen erlaubt (Standard ja). */
  allowSplit?: boolean
  /** speaker = folgt dem Sprechenden (Standard), main = bleibt bei der Hauptperson (Vlog), fixed = ein fester Ausschnitt (Solo). */
  follow?: 'speaker' | 'main' | 'fixed'
}

/** Mindestvorsprung (Logit) des besten Tracks vor dem zweiten, damit ASD zählt (clips-studio `_ASD_LEAD`). */
export const ASD_LEAD = 0.5

export const PLAN_DEFAULTS: PlanOptions = { switchRatio: 1.25, minSpeakSec: 1, ignoreAreaRatio: 0.1, moveLimit: 0.06, noSpeakerSec: 3, minShotSec: 0.8, pingPongSwitches: 3, pingPongWindowSec: 6, wideFaceArea: 0.004, groupMinPersons: 3 }

const at = (t: PlanTrack, i: number): { c: number; a: number; s: number } | null => {
  const k = i - t.start
  return k >= 0 && k < t.centres.length ? { c: t.centres[k], a: t.areas[k], s: t.scores[k] } : null
}

/** Mittelwert der ASD-Werte um einen Tick (±`half` Ticks), nur wo der Track existiert. */
function smooth(t: PlanTrack, i: number, half: number): number | null {
  let sum = 0
  let n = 0
  for (let k = i - half; k <= i + half; k++) { const v = at(t, k); if (v) { sum += v.s; n++ } }
  return n ? sum / n : null
}

/** Breite des 9:16-Ausschnitts als Anteil der Quellbreite. */
export const cropWidth = (sourceAspect: number, targetAspect = 9 / 16): number => Math.min(1, targetAspect / sourceAspect)
const clampCx = (cx: number, w: number): number => Math.min(1 - w / 2, Math.max(w / 2, cx))

interface Seg { start: number; end: number; track: number | null }

const t_ignored = (inp: PlanInput, t: PlanTrack): boolean => !!t.person && inp.personRoles?.[t.person] === 'ignore'
const isMain = (inp: PlanInput, id: number): boolean => { const t = inp.tracks.find((x) => x.id === id); return !!t?.person && inp.personRoles?.[t.person] === 'main' }
const speechAt = (inp: PlanInput, i: number): boolean => inp.speech ? !!inp.speech[i] : true

/** Aktiver Sprecher je Tick mit Hysterese: Wechsel nur bei ≥ 1,25× Score und ≥ 1 s Führung; Hintergrundgesichter (< 10 % der größten Fläche) zählen nicht. */
export function activeSpeakers(inp: PlanInput, opt: PlanOptions = PLAN_DEFAULTS): Array<number | null> {
  const half = Math.max(1, Math.round(0.4 / inp.dt))
  const needTicks = Math.round(opt.minSpeakSec / inp.dt)
  const out: Array<number | null> = []
  let active: number | null = null
  let lead: { id: number; since: number } | null = null
  for (let i = 0; i < inp.ticks; i++) {
    const present = inp.tracks.map((t) => ({ t, v: at(t, i) })).filter((x) => x.v && !(t_ignored(inp, x.t)))
    const maxA = Math.max(0, ...present.map((x) => x.v!.a))
    const cands = present.filter((x) => x.v!.a >= maxA * opt.ignoreAreaRatio).map((x) => ({ id: x.t.id, s: smooth(x.t, i, half) ?? -9 }))
    if (cands.length === 0) { out.push(null); active = null; lead = null; continue }
    const best = cands.reduce((a, b) => (b.s > a.s ? b : a))
    const cur = cands.find((c) => c.id === active)
    if (!cur) {
      // Neustart nach Kamerawechsel/Verlust: den Sprechenden, sonst das größte Gesicht
      const second = cands.filter((c) => c.id !== best.id).reduce((m, c) => Math.max(m, c.s), -Infinity)
      const clear = cands.length === 1 ? best.s > -0.5 : best.s - second > ASD_LEAD
      const main = cands.find((c) => isMain(inp, c.id))
      const speaking = best.s > 0 || (clear && speechAt(inp, i)) ? best : main ?? cands.reduce((a, b) => { const A = at(inp.tracks.find((t) => t.id === a.id)!, i)!.a; const B = at(inp.tracks.find((t) => t.id === b.id)!, i)!.a; return B > A ? b : a })
      active = speaking.id
      lead = null
    } else if (best.id !== cur.id && speechAt(inp, i) && (best.s > 0 ? (cur.s <= 0 || best.s >= cur.s * opt.switchRatio) : false) && best.s - cur.s > ASD_LEAD) {
      if (!lead || lead.id !== best.id) lead = { id: best.id, since: i }
      if (i - lead.since + 1 >= needTicks) { active = best.id; lead = null }
    } else lead = null
    out.push(active)
  }
  return out
}

/** Ping-Pong-Fenster: ≥ n Sprecherwechsel in `windowSec` Sekunden → Zwei-Personen-Fenster (split). */
/** Sind zwei Tracks an Tick i dieselbe Person (fragmentierter Track: Mitten < 0,15 auseinander)? */
function samePerson(tracks: PlanTrack[], a: number, b: number, i: number): boolean {
  const ta = tracks.find((t) => t.id === a)
  const tb = tracks.find((t) => t.id === b)
  const va = ta && at(ta, i)
  const vb = tb && at(tb, i - 1 < 0 ? i : i)
  return !!va && !!vb && Math.abs(va.c - vb.c) < SAME_PERSON
}
const SAME_PERSON = 0.15
/** Breite einer Split-Hälfte (Seitenverhältnis 1080:960) als Anteil der Quellbreite bei Zoom 1. */
export const splitHalfFrac = (sourceAspect: number): number => 1.125 / sourceAspect
const SPLIT_MAX_ZOOM = 1.8

export function pingPongWindows(active: Array<number | null>, dt: number, opt: PlanOptions = PLAN_DEFAULTS, tracks: PlanTrack[] = []): Array<[number, number]> {
  const sw: number[] = []
  for (let i = 1; i < active.length; i++) if (active[i] !== null && active[i - 1] !== null && active[i] !== active[i - 1] && !samePerson(tracks, active[i]!, active[i - 1]!, i)) sw.push(i)
  const win = Math.round(opt.pingPongWindowSec / dt)
  const out: Array<[number, number]> = []
  for (let i = 0; i + opt.pingPongSwitches - 1 < sw.length; i++) {
    if (sw[i + opt.pingPongSwitches - 1] - sw[i] <= win) {
      const range: [number, number] = [sw[i] - 1, sw[i + opt.pingPongSwitches - 1] + Math.round(1 / dt)]
      const last = out[out.length - 1]
      if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1])
      else out.push(range)
    }
  }
  return out
}

/** Hauptperson: Rolle „main“, sonst die Person mit der größten Gesamtfläche im Bild. */
export function mainTrack(inp: PlanInput): number | null {
  const cands = inp.tracks.filter((t) => !t_ignored(inp, t))
  const roled = cands.find((t) => !!t.person && inp.personRoles?.[t.person] === 'main')
  if (roled) return roled.id
  let best: { id: number; a: number } | null = null
  for (const t of cands) { const a = t.areas.reduce((x, y) => x + y, 0); if (!best || a > best.a) best = { id: t.id, a } }
  return best?.id ?? null
}

export function planShots(inp: PlanInput, opt0: PlanOptions = PLAN_DEFAULTS): ShortmeShot[] {
  const w = cropWidth(inp.sourceAspect, inp.targetAspect)
  const follow = opt0.follow ?? 'speaker'
  // Vlog/Solo: immer die Hauptperson, keine Sprecherwechsel, kein Split; Solo zusätzlich ein einziger fester Ausschnitt
  const opt: PlanOptions = follow === 'speaker' ? opt0 : { ...opt0, noSpeakerSec: 1e6, ...(follow === 'fixed' ? { moveLimit: 1 } : {}) }
  const main = follow === 'speaker' ? null : mainTrack(inp)
  const active: Array<number | null> = follow === 'speaker' ? activeSpeakers(inp, opt)
    : Array.from({ length: inp.ticks }, (_, i) => { const t = inp.tracks.find((x) => x.id === main); return t && at(t, i) ? t.id : null })
  const pp = follow !== 'speaker' || opt.allowSplit === false ? [] : pingPongWindows(active, inp.dt, opt, inp.tracks)
  const inPP = (i: number): boolean => pp.some(([a, b]) => i >= a && i <= b)
  const noSpeakerTicks = Math.round(opt.noSpeakerSec / inp.dt)

  // Segmente: Wechsel des aktiven Tracks, Kamerawechsel, Ping-Pong-Fenster
  const cutSet = new Set(inp.cuts)
  const segs: Seg[] = []
  let cur: Seg | null = null
  for (let i = 0; i < inp.ticks; i++) {
    const key = inPP(i) ? -2 : active[i]
    if (!cur || cutSet.has(i) || key !== cur.track) { if (cur) segs.push(cur); cur = { start: i, end: i, track: key } } else cur.end = i
  }
  if (cur) segs.push(cur)

  // zu kurze Segmente (ohne Kamerawechsel) mit dem Vorgänger verschmelzen → kein Flackern
  const minTicks = Math.round(opt.minShotSec / inp.dt)
  const merged: Seg[] = []
  for (const s of segs) {
    const prev = merged[merged.length - 1]
    const dropout = s.track === null && !cutSet.has(s.start) && s.end - s.start + 1 < Math.round(1.5 / inp.dt)
    if (prev && (s.end - s.start + 1 < minTicks || dropout)) prev.end = s.end
    else merged.push({ ...s })
  }

  const shots: ShortmeShot[] = []
  const push = (a: number, b: number, shot: Omit<ShortmeShot, 'start' | 'end'>): void => { shots.push({ start: a * inp.dt, end: (b + 1) * inp.dt, ...shot }) }

  // Sichtbare Personen eines Abschnitts (in ≥ 60 % der Ticks vorhanden, nicht ignoriert): Mitte und Fläche (Median)
  const visible = (a: number, b: number): Array<{ id: number; c: number; area: number }> => inp.tracks.filter((t) => !t_ignored(inp, t)).flatMap((t) => {
    const cs: number[] = []
    const as: number[] = []
    for (let i = a; i <= b; i++) { const v = at(t, i); if (v) { cs.push(v.c); as.push(v.a) } }
    return cs.length >= 0.6 * (b - a + 1) ? [{ id: t.id, c: median(cs), area: median(as) }] : []
  })
  const wideArea = opt.wideFaceArea ?? PLAN_DEFAULTS.wideFaceArea!
  const groupMin = opt.groupMinPersons ?? PLAN_DEFAULTS.groupMinPersons!
  /** Vollbild ist sinnvoller als Tracking: Person(en) winzig (Totale) oder Gruppe, die nicht in einen 9:16-Ausschnitt passt. */
  const wantsFull = (seg: Seg): boolean => {
    if (seg.end - seg.start + 1 < minTicks) return false
    const vis = visible(seg.start, seg.end)
    if (!vis.length) return false
    const target = seg.track !== null && seg.track >= 0 ? vis.find((v) => v.id === seg.track) : undefined
    if (target ? target.area < wideArea : vis.every((v) => v.area < wideArea)) return true
    const span = Math.max(...vis.map((v) => v.c)) - Math.min(...vis.map((v) => v.c))
    const tr = seg.track !== null && seg.track >= 0 ? inp.tracks.find((t) => t.id === seg.track) : undefined
    const sc: number[] = []
    if (tr) for (let i = seg.start; i <= seg.end; i++) { const v = at(tr, i); if (v) sc.push(v.s) }
    const talking = sc.length > 0 && median(sc) > 0
    return vis.length >= groupMin && span > w * 0.9 && !talking
  }

  for (const s of merged) {
    if (s.track !== -2 && wantsFull(s)) { push(s.start, s.end, { layout: 'fit', cx: 0.5, zoom: 1 }); continue }
    if (s.track === -2) {
      // Dialog-Fenster: zwei meistgezeigte Gesichter übereinander
      const ids = [...new Set(active.slice(s.start, s.end + 1).filter((x): x is number => x !== null))]
      const pick = ids.slice(0, 2).map((id) => inp.tracks.find((t) => t.id === id)!)
      if (pick.length === 2) {
        const cxs = pick.map((t) => { const cs: number[] = []; for (let i = s.start; i <= s.end; i++) { const v = at(t, i); if (v) cs.push(v.c) } return median(cs.length ? cs : [0.5]) })
        const [left, right] = cxs[0] <= cxs[1] ? [cxs[0], cxs[1]] : [cxs[1], cxs[0]]
        // Split nur, wenn ein einzelner 9:16-Ausschnitt nicht beide trägt. Jede Hälfte ist breiter als ein 9:16-Ausschnitt
        // (Seitenverhältnis 9:8) → bei dichten Personen würde jede Hälfte beide zeigen (doppeltes Bild): dann je Hälfte hineinzoomen.
        const sep = right - left
        if (sep <= w * 0.9) { push(s.start, s.end, { layout: 'smart', cx: clampCx((left + right) / 2, w), zoom: 1, track: pick[0].id }); continue }
        const z = Math.max(1, splitHalfFrac(inp.sourceAspect) / (0.95 * sep))
        if (z > SPLIT_MAX_ZOOM) { push(s.start, s.end, { layout: 'smart', cx: clampCx((left + right) / 2, w), zoom: 1, track: pick[0].id }); continue }
        const hw = splitHalfFrac(inp.sourceAspect) / z
        push(s.start, s.end, { layout: 'split', cx: clampCx(left, hw), cx2: clampCx(right, hw), zoom: z })
        continue
      }
    }
    if (s.track === null || s.track === -2) {
      // Kein klarer Sprecher: NIE die Bildmitte (zwischen zwei Personen ist sie leer). Reihenfolge: sichtbare Person(en) zeigen
      // (eine → Ausschnitt auf sie, zwei getrennte → Split), sonst das ganze Bild (Vollbild mit unscharfem Hintergrund).
      const vis = visible(s.start, s.end).sort((x, y) => y.area - x.area)
      if (vis.length === 0) { push(s.start, s.end, { layout: 'fit', cx: 0.5, zoom: 1 }); continue }
      if (vis.length >= 2 && opt.allowSplit !== false) {
        const [l, r] = vis[0].c <= vis[1].c ? [vis[0].c, vis[1].c] : [vis[1].c, vis[0].c]
        const sep = r - l
        const z = Math.max(1, splitHalfFrac(inp.sourceAspect) / (0.95 * Math.max(sep, 1e-3)))
        if (sep > w * 0.9 && z <= SPLIT_MAX_ZOOM) {
          const hw = splitHalfFrac(inp.sourceAspect) / z
          push(s.start, s.end, { layout: 'split', cx: clampCx(l, hw), cx2: clampCx(r, hw), zoom: z })
        } else push(s.start, s.end, { layout: 'smart', cx: clampCx((l + r) / 2, w), zoom: 1 })
        continue
      }
      push(s.start, s.end, { layout: 'smart', cx: clampCx(vis[0].c, w), zoom: 1 })
      continue
    }
    const track = inp.tracks.find((t) => t.id === s.track)!
    // Bereiche: Abschnitte, in denen der Track > 3 s nicht spricht, werden zu einem mittigen festen Ausschnitt
    const ranges: Array<{ a: number; b: number; quiet: boolean }> = []
    let runStart = s.start
    let quietRun = 0
    const isQuiet = (i: number): boolean => { const v = at(track, i); return !v || v.s <= 0 }
    for (let i = s.start; i <= s.end; i++) {
      quietRun = isQuiet(i) ? quietRun + 1 : 0
      if (quietRun === noSpeakerTicks) {
        const qs = i - noSpeakerTicks + 1
        if (qs > runStart) ranges.push({ a: runStart, b: qs - 1, quiet: false })
        runStart = qs
        ranges.push({ a: qs, b: -1, quiet: true })
      }
      if (quietRun === 0 && ranges.length && ranges[ranges.length - 1].quiet && ranges[ranges.length - 1].b === -1) {
        ranges[ranges.length - 1].b = i - 1
        runStart = i
      }
    }
    const lastR = ranges[ranges.length - 1]
    if (lastR && lastR.quiet && lastR.b === -1) lastR.b = s.end
    else if (runStart <= s.end) ranges.push({ a: runStart, b: s.end, quiet: false })
    for (const r of ranges) {
      if (r.quiet) {
        // Person spricht gerade nicht: trotzdem bei ihr bleiben (nicht in die Bildmitte springen)
        const cs: number[] = []
        for (let i = r.a; i <= r.b; i++) { const v = at(track, i); if (v) cs.push(v.c) }
        push(r.a, r.b, { layout: 'smart', cx: clampCx(median(cs.length ? cs : [0.5]), w), zoom: 1, track: track.id })
        continue
      }
      // feste Ausschnitte: Subjekt wandert > 12 % → neuer fester Ausschnitt statt Verfolgen
      let from = r.a
      let anchor: number | null = null
      let acc: number[] = []
      const close = (end: number): void => {
        if (end < from) return
        push(from, end, { layout: 'smart', cx: clampCx(median(acc.length ? acc : [anchor ?? 0.5]), w), zoom: 1, track: track.id })
      }
      for (let i = r.a; i <= r.b; i++) {
        const v = at(track, i)
        if (!v) continue
        if (anchor === null) anchor = v.c
        if (Math.abs(v.c - anchor) > opt.moveLimit && i - from >= minTicks) { close(i - 1); from = i; anchor = v.c; acc = [] }
        acc.push(v.c)
      }
      close(r.b)
    }
  }
  shots.sort((x, y) => x.start - y.start)
  const out: ShortmeShot[] = []
  for (const sh of shots) {
    const p = out[out.length - 1]
    const same = p && p.layout === sh.layout && Math.abs(p.cx - sh.cx) < 0.05 && Math.abs((p.cx2 ?? 0) - (sh.cx2 ?? 0)) < 0.05
    if (same) p.end = sh.end
    else out.push({ ...sh })
  }
  // Rest-Splitter (< 0,75 s) in den Vorgänger (bzw. Nachfolger) aufnehmen: kurze Einstellungen wirken wie Flackern
  for (let i = 0; i < out.length && out.length > 1; ) {
    if (out[i].end - out[i].start < 0.75) {
      if (i > 0) out[i - 1].end = out[i].end
      else out[1].start = out[0].start
      out.splice(i, 1)
    } else i++
  }
  return out
}

function median(v: number[]): number {
  const s = [...v].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

/** Gesichtsquote: Anteil der Zeit, in der ein Gesicht (aktiver Sprecher bzw. irgendein Gesicht) im Ausschnitt/Bild ist. */
export function faceRatio(shots: ShortmeShot[], inp: PlanInput): number {
  if (shots.length === 0 || inp.ticks === 0) return 0
  const w = cropWidth(inp.sourceAspect, inp.targetAspect)
  let hit = 0
  for (let i = 0; i < inp.ticks; i++) {
    const t = i * inp.dt + inp.dt / 2
    const shot = shots.find((s) => t >= s.start && t < s.end)
    if (!shot) continue
    const faces = inp.tracks.map((tr) => at(tr, i)).filter((v): v is NonNullable<typeof v> => !!v)
    if (shot.layout === 'fit') { if (faces.length) hit++; continue }
    const half = shot.layout === 'split' ? splitHalfFrac(inp.sourceAspect) / shot.zoom : w / shot.zoom
    const inCrop = (cx: number | undefined, c: number): boolean => cx !== undefined && Math.abs(c - cx) <= half / 2
    if (faces.some((f) => inCrop(shot.cx, f.c) || inCrop(shot.cx2, f.c))) hit++
  }
  return hit / inp.ticks
}

/** Abzug im Ranking bei Gesichtsquote < 60 %: bis zu 20 Punkte. */
export function facePenalty(ratio: number): number {
  return ratio >= 0.6 ? 0 : Math.round(Math.min(20, (0.6 - ratio) * 40))
}

/**
 * Sicherheitsnetz vor dem Rendern: liegt im geplanten Ausschnitt (smart/fest) über mehr als `minSec` Sekunden keine erkannte Person
 * (Gesicht oder Kopf/Pose – beides steckt in den Spuren), wird dieser Abschnitt auf „Ganzes Bild“ (unscharfer Hintergrund) gestellt und
 * mit `auto: 'empty'` markiert. Split, Ganzes Bild und Facecam-Layouts bleiben unberührt. Reine Funktion – Analyse, Vorschau und Export
 * nutzen dieselben Shots.
 */
export function guardEmptyShots(shots: ShortmeShot[], inp: PlanInput, minSec = 0.5): ShortmeShot[] {
  const w = cropWidth(inp.sourceAspect, inp.targetAspect)
  const out: ShortmeShot[] = []
  for (const sh of shots) {
    if (sh.layout !== 'smart' && sh.layout !== 'fixed') { out.push(sh); continue }
    const half = w / sh.zoom / 2
    const empty = (i: number): boolean => !inp.tracks.some((tr) => { const v = at(tr, i); return !!v && Math.abs(v.c - sh.cx) <= half })
    const i0 = Math.max(0, Math.floor(sh.start / inp.dt)), i1 = Math.min(inp.ticks, Math.ceil(sh.end / inp.dt))
    // zusammenhängende leere Tick-Läufe ≥ minSec
    const runs: Array<[number, number]> = []
    for (let i = i0; i < i1;) {
      if (!empty(i)) { i++; continue }
      let j = i
      while (j < i1 && empty(j)) j++
      if ((j - i) * inp.dt > minSec + 1e-9) runs.push([Math.max(sh.start, i * inp.dt), Math.min(sh.end, j * inp.dt)])
      i = j
    }
    if (!runs.length) { out.push(sh); continue }
    let cur = sh.start
    for (const [a, b] of runs) {
      if (a > cur + 1e-6) out.push({ ...sh, start: cur, end: a })
      out.push({ start: a, end: b, layout: 'fit', cx: 0.5, zoom: 1, auto: 'empty' })
      cur = b
    }
    if (sh.end > cur + 1e-6) out.push({ ...sh, start: cur, end: sh.end })
  }
  // Rest-Splitter < 0,3 s an den Nachbarn hängen (kein Flackern), gleiche Nachbarn verschmelzen
  const merged: ShortmeShot[] = []
  for (const s of out) {
    const p = merged[merged.length - 1]
    if (p && p.layout === s.layout && p.auto === s.auto && Math.abs(p.cx - s.cx) < 0.01) p.end = s.end
    else merged.push({ ...s })
  }
  return merged
}
