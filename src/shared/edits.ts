// Nicht-destruktive Bearbeitung: Operationen statt Änderungen an den Daten (Undo/Redo = Cursor im Operationslog).
// Reine Funktionen – von Main (Export, Persistenz) und Renderer (Editor) gemeinsam genutzt.

import type { ShortmeClip, ShortmeShot } from './shortme'
import { deepMerge, type PresetPatch } from './preset'
import { planShots, type PlanInput, type PlanTrack } from './layoutPlan'

/** Änderung am Untertitel-/Titelstil: anderes Preset und/oder Änderungen am Preset (tief zusammengeführt). */
export interface CaptionPatch {
  presetId?: string
  /** Änderungen relativ zum Preset (Untertitel + Titel), siehe shared/preset.ts */
  style?: PresetPatch
  /** Vorherige Änderungen verwerfen (beim Wechsel des Presets). */
  resetStyle?: boolean
  /** KI-Hervorhebung (betonte Wörter) an/aus */
  highlight?: boolean
  /** Sicherheitszone (nur Anzeige im Editor). */
  zone?: 'Aus' | 'TikTok' | 'Reels' | 'Shorts'
}

export type Op =
  | { t: 'trim'; start: number; end: number }
  /** Wörter (globale Wortindizes) herausschneiden (cut=true) oder wiederherstellen (cut=false). */
  | { t: 'cutWords'; words: number[]; cut: boolean }
  | { t: 'hook'; text?: string; seconds?: number; enabled?: boolean }
  /** Untertitel-Text eines Wortes ändern (Tippfehler der Erkennung); Transkript bleibt unverändert. */
  | { t: 'editWord'; word: number; text: string }
  | { t: 'caption'; patch: CaptionPatch }
  /** Layout ab Quellzeit `at` bis zum Ende der Einstellung. */
  | { t: 'layout'; at: number; layout: ShortmeShot['layout']; cx?: number }
  /** Person angeklickt: Kamera folgt ab Quellzeit `at` dem Punkt `cx` (0..1 der Quellbreite). */
  | { t: 'follow'; at: number; cx: number }
  /** Ganzer Clip: `smart` = automatischer Plan (alle Layout-Änderungen davor entfallen), sonst überall dieses Layout (Vollbild = fest, Mitte). */
  | { t: 'layoutClip'; layout: ShortmeShot['layout'] }

export interface EditLog { version: 1; clipId: string; ops: Op[]; /** Anzahl angewendeter Operationen (Rest = Redo). */ cursor: number }

export interface EditState {
  start: number
  end: number
  cutWords: number[]
  hook: { text: string; seconds: number; enabled: boolean }
  /** Globaler Wortindex → geänderter Untertitel-Text. */
  wordEdits: Record<number, string>
  caption: { presetId: string; highlight: boolean; zone: NonNullable<CaptionPatch['zone']>; style: PresetPatch }
  layoutOps: Array<Extract<Op, { t: 'layout' | 'follow' | 'layoutClip' }>>
}

export const emptyLog = (clipId: string): EditLog => ({ version: 1, clipId, ops: [], cursor: 0 })

/** Globale Standardwerte (Stil-Studio → „Als Standard festlegen“, Erstellen-Dialog): Preset, Änderungen daran, Titel an/aus. */
export interface StyleDefaults { presetId?: string; style?: PresetPatch; titleEnabled?: boolean }

export function baseState(clip: Pick<ShortmeClip, 'start' | 'end' | 'hookText'> & { corrections?: Record<number, string> }, presetId = 'glow-karaoke', defaults: StyleDefaults = {}): EditState {
  return { start: clip.start, end: clip.end, cutWords: [], hook: { text: clip.hookText, seconds: 3, enabled: !!defaults.titleEnabled }, wordEdits: { ...(clip.corrections ?? {}) }, caption: { presetId: defaults.presetId ?? presetId, highlight: true, zone: 'Aus', style: defaults.style ?? {} }, layoutOps: [] }
}

/** Zustand = Basis + alle Operationen bis zum Cursor. */
export function reduce(base: EditState, ops: Op[]): EditState {
  const s: EditState = { ...base, cutWords: [...base.cutWords], hook: { ...base.hook }, wordEdits: { ...base.wordEdits }, caption: { ...base.caption, style: { ...base.caption.style } }, layoutOps: [...base.layoutOps] }
  for (const op of ops) {
    switch (op.t) {
      case 'trim': s.start = Math.min(op.start, op.end - 0.5); s.end = op.end; break
      case 'cutWords': {
        const set = new Set(s.cutWords)
        for (const w of op.words) op.cut ? set.add(w) : set.delete(w)
        s.cutWords = [...set].sort((a, b) => a - b)
        break
      }
      case 'hook': s.hook = { text: op.text ?? s.hook.text, seconds: op.seconds ?? s.hook.seconds, enabled: op.enabled ?? s.hook.enabled }; break
      case 'editWord': if (op.text.trim()) s.wordEdits[op.word] = op.text.trim(); else delete s.wordEdits[op.word]; break
      case 'caption': {
        const p = op.patch
        s.caption = { presetId: p.presetId ?? s.caption.presetId, highlight: p.highlight ?? s.caption.highlight, zone: p.zone ?? s.caption.zone, style: p.resetStyle ? (p.style ?? {}) : deepMerge(s.caption.style, p.style ?? {}) }
        break
      }
      case 'layoutClip': s.layoutOps = []; s.layoutOps.push(op); break
      case 'layout':
      case 'follow': s.layoutOps.push(op); break
    }
  }
  return s
}

export const stateOf = (base: EditState, log: EditLog): EditState => reduce(base, log.ops.slice(0, log.cursor))

/** Neue Operation anhängen; alles hinter dem Cursor (Redo-Zweig) wird verworfen. Mehrere Trim-/Hook-/Caption-Operationen direkt hintereinander verschmelzen nicht – jede ist ein Undo-Schritt. */
export function push(log: EditLog, op: Op): EditLog {
  return { ...log, ops: [...log.ops.slice(0, log.cursor), op], cursor: log.cursor + 1 }
}
export const undo = (log: EditLog): EditLog => (log.cursor > 0 ? { ...log, cursor: log.cursor - 1 } : log)
export const redo = (log: EditLog): EditLog => (log.cursor < log.ops.length ? { ...log, cursor: log.cursor + 1 } : log)
export const canUndo = (log: EditLog): boolean => log.cursor > 0
export const canRedo = (log: EditLog): boolean => log.cursor < log.ops.length

/** Gültigkeit einer geladenen Logdatei (Defekte Dateien dürfen die App nie blockieren). */
export function sanitizeLog(x: unknown, clipId: string): EditLog {
  if (typeof x !== 'object' || x === null) return emptyLog(clipId)
  const l = x as Partial<EditLog>
  if (l.version !== 1 || !Array.isArray(l.ops)) return emptyLog(clipId)
  const ops = l.ops.filter((o): o is Op => typeof o === 'object' && o !== null && typeof (o as { t?: unknown }).t === 'string')
  return { version: 1, clipId, ops, cursor: Math.max(0, Math.min(ops.length, Number.isInteger(l.cursor) ? (l.cursor as number) : ops.length)) }
}

export interface WordT { start: number; end: number }

/** Wirksamer Clip nach den Edits: neue Wortgrenzen, Shots auf den neuen Beginn bezogen und mit Layout-/Follow-Überschreibungen. */
export function effectiveClip<C extends Pick<ShortmeClip, 'start' | 'end' | 'firstWord' | 'lastWord' | 'shots' | 'hookText'>>(clip: C, words: WordT[], st: EditState, layout?: PlanInput | null): C & { removed: Array<[number, number]>; wordEdits: Record<number, string> } {
  let first = clip.firstWord
  let last = clip.lastWord
  // Wörter, die vollständig im Bereich liegen
  const inRange = (i: number): boolean => words[i] && words[i].start >= st.start - 1e-6 && words[i].end <= st.end + 1e-6
  let a = -1
  let b = -1
  const from = Math.max(0, Math.min(clip.firstWord - 200, words.length - 1))
  const to = Math.min(words.length - 1, clip.lastWord + 200)
  for (let i = from; i <= to; i++) if (inRange(i)) { if (a < 0) a = i; b = i }
  if (a >= 0) { first = a; last = b }
  const removed: Array<[number, number]> = st.cutWords.filter((i) => i >= first && i <= last && words[i]).map((i) => [words[i].start, words[i].end] as [number, number])
  // Shots auf absolute Zeit, dann Überschreibungen, dann auf neuen Beginn beziehen
  const abs = (clip.shots ?? []).map((s) => ({ ...s, start: clip.start + s.start, end: clip.start + s.end }))
  const shots = applyLayoutOps(abs, st.layoutOps, st.start, st.end, layout ? { input: layout, clipStart: clip.start } : undefined).map((s) => ({ ...s, start: s.start - st.start, end: s.end - st.start }))
  return { ...clip, start: st.start, end: st.end, firstWord: first, lastWord: last, shots, hookText: st.hook.text, removed, wordEdits: st.wordEdits }
}

/** Layout-/Follow-Operationen auf absolute Shots anwenden und auf [from,to] beschneiden. Reihenfolge der Operationen zählt (letzte gewinnt). */
/** Kamera-Einstellung (zwischen zwei Schnitten) um die Tick-Position `tick`: [Beginn, Ende) in Ticks. */
export function sceneRange(input: PlanInput, tick: number): [number, number] {
  const cuts = [0, ...input.cuts.filter((c) => c > 0 && c < input.ticks), input.ticks]
  for (let i = 0; i < cuts.length - 1; i++) if (tick >= cuts[i] && tick < cuts[i + 1]) return [cuts[i], cuts[i + 1]]
  return [0, input.ticks]
}

/**
 * „Person anklicken“, szenenweise konsistent: die gewählte Person (Track nächster zur Klickposition) bestimmt den Ausschnitt in der
 * GANZEN Kameraeinstellung – davor und danach. Lücken der Erkennung werden mit der letzten bekannten Position überbrückt; wandert die
 * Person > 12 %, entsteht ein weiterer fester Ausschnitt (kein Schwenk, kein Springen zwischen Personen).
 */
export function followScene(input: PlanInput, clipStart: number, at: number, cx: number): ShortmeShot[] | null {
  const tick = Math.max(0, Math.min(input.ticks - 1, Math.round((at - clipStart) / input.dt)))
  const [a, b] = sceneRange(input, tick)
  const present = (t: PlanTrack, i: number): boolean => i >= t.start && i < t.start + t.centres.length
  let best: { t: PlanTrack; d: number } | null = null
  for (const t of input.tracks) {
    // Position im Klickmoment, sonst die nächstliegende innerhalb der Einstellung
    let at2 = -1
    for (let k = 0; k <= b - a; k++) for (const i of [tick - k, tick + k]) if (at2 < 0 && i >= a && i < b && present(t, i)) at2 = i
    if (at2 < 0) continue
    const d = Math.abs(t.centres[at2 - t.start] - cx)
    if (!best || d < best.d) best = { t, d }
  }
  if (!best || best.d > 0.18) return null
  const t = best.t
  const n = b - a
  const centres: number[] = []
  const areas: number[] = []
  let lastC = -1
  let lastA = 0.1
  for (let i = a; i < b; i++) if (present(t, i)) { lastC = t.centres[i - t.start]; lastA = t.areas[i - t.start]; break }
  for (let i = a; i < b; i++) {
    if (present(t, i)) { lastC = t.centres[i - t.start]; lastA = t.areas[i - t.start] }
    centres.push(lastC)
    areas.push(lastA)
  }
  const forced: PlanTrack = { id: t.id, start: 0, centres, areas, scores: new Array<number>(n).fill(1) }
  const planned = planShots({ tracks: [forced], ticks: n, dt: input.dt, cuts: [], sourceAspect: input.sourceAspect })
  return planned.map((p) => ({ ...p, start: clipStart + a * input.dt + p.start, end: clipStart + a * input.dt + p.end }))
}

export function applyLayoutOps(shots: ShortmeShot[], ops: EditState['layoutOps'], from: number, to: number, scene?: { input: PlanInput; clipStart: number }): ShortmeShot[] {
  let cur = shots.map((s) => ({ ...s }))
  if (cur.length === 0) cur = [{ start: from, end: to, layout: 'fixed', cx: 0.5, zoom: 1 }]
  for (const op of ops) {
    if (op.t === 'layoutClip') {
      if (op.layout === 'smart') { cur = shots.map((s) => ({ ...s })); continue }
      cur = [{ start: from, end: to, layout: op.layout, cx: 0.5, zoom: 1 }]
      continue
    }
    if (scene) {
      // szenenweise: gilt für die ganze Kameraeinstellung um `at` (kein Springen zwischen Personen davor/danach)
      const tick = Math.round((op.at - scene.clipStart) / scene.input.dt)
      const [ta, tb] = sceneRange(scene.input, Math.max(0, Math.min(scene.input.ticks - 1, tick)))
      const s0 = scene.clipStart + ta * scene.input.dt
      const s1 = scene.clipStart + tb * scene.input.dt
      const repl = op.t === 'follow' ? followScene(scene.input, scene.clipStart, op.at, op.cx) : [{ start: s0, end: s1, layout: op.layout, cx: op.cx ?? cur.find((x) => op.at >= x.start && op.at < x.end)?.cx ?? 0.5, zoom: 1 } as ShortmeShot]
      if (repl) {
        const out: ShortmeShot[] = []
        for (const s of cur) {
          if (s.end <= s0 + 1e-6 || s.start >= s1 - 1e-6) { out.push(s); continue }
          if (s.start < s0 - 1e-6) out.push({ ...s, end: s0 })
          if (s.end > s1 + 1e-6) out.push({ ...s, start: s1 })
        }
        out.push(...repl)
        cur = out.sort((x, y) => x.start - y.start)
        continue
      }
    }
    const out: ShortmeShot[] = []
    for (const s of cur) {
      if (op.at <= s.start - 1e-6 || op.at >= s.end - 1e-6) { out.push(s); continue }
      // Einstellung teilen: vorher unverändert, ab `at` neu (fester Ausschnitt – keine Kamerabewegung)
      out.push({ ...s, end: op.at })
      const next: ShortmeShot = op.t === 'follow'
        ? { start: op.at, end: s.end, layout: 'smart', cx: op.cx, zoom: s.zoom }
        : { start: op.at, end: s.end, layout: op.layout, cx: op.cx ?? s.cx, zoom: s.zoom, ...(op.layout === 'split' && s.cx2 !== undefined ? { cx2: s.cx2 } : {}) }
      out.push(next)
    }
    cur = out
  }
  cur = cur.map((s) => ({ ...s, start: Math.max(s.start, from), end: Math.min(s.end, to) })).filter((s) => s.end - s.start > 1e-3).sort((a, b) => a.start - b.start)
  if (cur.length === 0) return [{ start: from, end: to, layout: 'fixed', cx: 0.5, zoom: 1 }]
  // Beschnitt über die ursprünglichen Shots hinaus: erste/letzte Einstellung verlängern (keine Lücken)
  cur[0] = { ...cur[0], start: from }
  cur[cur.length - 1] = { ...cur[cur.length - 1], end: to }
  return cur
}
