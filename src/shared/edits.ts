// Nicht-destruktive Bearbeitung: Operationen statt Änderungen an den Daten (Undo/Redo = Cursor im Operationslog).
// Reine Funktionen – von Main (Export, Persistenz) und Renderer (Editor) gemeinsam genutzt.

import type { ShortmeClip, ShortmeShot } from './shortme'

export interface CaptionPatch {
  presetId?: string
  /** Schriftgröße-Faktor (1 = Preset). */
  scale?: number
  /** Vertikale Mitte 0..1. */
  y?: number
  highlight?: boolean
  /** Sicherheitszone (nur Anzeige im Editor). */
  zone?: 'Aus' | 'TikTok' | 'Reels' | 'Shorts'
}

export type Op =
  | { t: 'trim'; start: number; end: number }
  /** Wörter (globale Wortindizes) herausschneiden (cut=true) oder wiederherstellen (cut=false). */
  | { t: 'cutWords'; words: number[]; cut: boolean }
  | { t: 'hook'; text: string; seconds?: number }
  | { t: 'caption'; patch: CaptionPatch }
  /** Layout ab Quellzeit `at` bis zum Ende der Einstellung. */
  | { t: 'layout'; at: number; layout: ShortmeShot['layout']; cx?: number }
  /** Person angeklickt: Kamera folgt ab Quellzeit `at` dem Punkt `cx` (0..1 der Quellbreite). */
  | { t: 'follow'; at: number; cx: number }

export interface EditLog { version: 1; clipId: string; ops: Op[]; /** Anzahl angewendeter Operationen (Rest = Redo). */ cursor: number }

export interface EditState {
  start: number
  end: number
  cutWords: number[]
  hook: { text: string; seconds: number }
  caption: Required<Pick<CaptionPatch, 'presetId' | 'scale' | 'y' | 'highlight' | 'zone'>> & { presetId: string }
  layoutOps: Array<Extract<Op, { t: 'layout' | 'follow' }>>
}

export const emptyLog = (clipId: string): EditLog => ({ version: 1, clipId, ops: [], cursor: 0 })

export function baseState(clip: Pick<ShortmeClip, 'start' | 'end' | 'hookText'>, presetId = 'impact'): EditState {
  return { start: clip.start, end: clip.end, cutWords: [], hook: { text: clip.hookText, seconds: 3 }, caption: { presetId, scale: 1, y: 0.68, highlight: true, zone: 'Aus' }, layoutOps: [] }
}

/** Zustand = Basis + alle Operationen bis zum Cursor. */
export function reduce(base: EditState, ops: Op[]): EditState {
  const s: EditState = { ...base, cutWords: [...base.cutWords], hook: { ...base.hook }, caption: { ...base.caption }, layoutOps: [...base.layoutOps] }
  for (const op of ops) {
    switch (op.t) {
      case 'trim': s.start = Math.min(op.start, op.end - 0.5); s.end = op.end; break
      case 'cutWords': {
        const set = new Set(s.cutWords)
        for (const w of op.words) op.cut ? set.add(w) : set.delete(w)
        s.cutWords = [...set].sort((a, b) => a - b)
        break
      }
      case 'hook': s.hook = { text: op.text, seconds: op.seconds ?? s.hook.seconds }; break
      case 'caption': s.caption = { ...s.caption, ...Object.fromEntries(Object.entries(op.patch).filter(([, v]) => v !== undefined)) } as EditState['caption']; break
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
export function effectiveClip<C extends Pick<ShortmeClip, 'start' | 'end' | 'firstWord' | 'lastWord' | 'shots' | 'hookText'>>(clip: C, words: WordT[], st: EditState): C & { removed: Array<[number, number]> } {
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
  const shots = applyLayoutOps(abs, st.layoutOps, st.start, st.end).map((s) => ({ ...s, start: s.start - st.start, end: s.end - st.start }))
  return { ...clip, start: st.start, end: st.end, firstWord: first, lastWord: last, shots, hookText: st.hook.text, removed }
}

/** Layout-/Follow-Operationen auf absolute Shots anwenden und auf [from,to] beschneiden. Reihenfolge der Operationen zählt (letzte gewinnt). */
export function applyLayoutOps(shots: ShortmeShot[], ops: EditState['layoutOps'], from: number, to: number): ShortmeShot[] {
  let cur = shots.map((s) => ({ ...s }))
  if (cur.length === 0) cur = [{ start: from, end: to, layout: 'fixed', cx: 0.5, zoom: 1 }]
  for (const op of ops) {
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
