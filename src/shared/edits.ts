// Nicht-destruktive Bearbeitung: Operationen statt Änderungen an den Daten (Undo/Redo = Cursor im Operationslog).
// Reine Funktionen – von Main (Export, Persistenz) und Renderer (Editor) gemeinsam genutzt.

import type { ShortmeClip, ShortmeShot } from './shortme'
import { deepMerge, type PresetPatch } from './preset'
import { planShots, type PlanInput, type PlanTrack } from './layoutPlan'
import { isFullStream, sameCam, type StreamLayout } from './streamLayout'
import { clampDb, type AudioClip, type VoiceRange } from './audioMix'
import type { SegMove } from './segments'

/** Änderung am Untertitel-/Titelstil: anderes Preset und/oder Änderungen am Preset (tief zusammengeführt). */
export interface CaptionPatch {
  presetId?: string
  /** Änderungen relativ zum Preset (Untertitel + Titel), siehe shared/preset.ts */
  style?: PresetPatch
  /** Vorherige Änderungen verwerfen (beim Wechsel des Presets). */
  resetStyle?: boolean
  /** KI-Hervorhebung (betonte Wörter) an/aus */
  highlight?: boolean
  /** Untertitel ein-/ausblenden (Vorschau und Export). */
  enabled?: boolean
  /** Sicherheitszone (nur Anzeige im Editor). */
  zone?: 'Aus' | 'TikTok' | 'Reels' | 'Shorts'
}

/** Änderung am Facecam-Layout: Rahmen, Layout-Variante, Abstand. Ohne `at` für den ganzen Clip, mit `at` nur für die Szene (Einstellung) um diese Quellzeit. */
export type StreamPatch = Partial<StreamLayout>

export type Op =
  | { t: 'trim'; start: number; end: number }
  /** Wörter (globale Wortindizes) herausschneiden (cut=true) oder wiederherstellen (cut=false). */
  | { t: 'cutWords'; words: number[]; cut: boolean }
  /** Automatisch entfernte Abschnitte (Quellzeit) wiederherstellen (cut=false) oder erneut anwenden (cut=true); getrennt von cutWords, nichts wird doppelt angewendet. */
  | { t: 'autoCuts'; ranges: Array<{ start: number; end: number }>; cut: boolean }
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
  | { t: 'stream'; patch: StreamPatch; at?: number }
  /** Tonspur: `clip` = hinzufügen, `patch` = verschieben/pegeln, `remove` = entfernen. */
  | { t: 'audio'; id: string; clip?: AudioClip; patch?: Partial<Pick<AudioClip, 'at' | 'gainDb' | 'in' | 'dur'>>; remove?: boolean }
  /** Tonspur an Quellzeit `at` teilen: vorderer Teil behält die id, hinterer bekommt `newId`. */
  | { t: 'audioSplit'; id: string; at: number; newId: string }
  /** Schnittpunkt im Video setzen (oder mit remove entfernen); teilt den Clip in Stücke. */
  | { t: 'split'; at: number; remove?: boolean }
  /** Videostück verschieben (Reihenfolge im Export). */
  | { t: 'moveSeg'; move: SegMove }
  /** Pegel des Originaltons in dB. */
  | { t: 'voice'; gainDb: number }
  /** Pegel eines Bereichs im Originalton: `range` = anlegen, `patch` = ändern, `remove` = entfernen. */
  | { t: 'voiceRange'; id: string; range?: VoiceRange; patch?: Partial<Omit<VoiceRange, 'id'>>; remove?: boolean }

export interface EditLog { version: 1; clipId: string; ops: Op[]; /** Anzahl angewendeter Operationen (Rest = Redo). */ cursor: number }

export interface EditState {
  start: number
  end: number
  cutWords: number[]
  /** Aktive automatische Kürzungen der neuen Engine (Quellsekunden), unabhängig von den Wortlöschungen. */
  autoCuts: Array<{ start: number; end: number }>
  hook: { text: string; seconds: number; enabled: boolean }
  /** Globaler Wortindex → geänderter Untertitel-Text. */
  wordEdits: Record<number, string>
  caption: { presetId: string; enabled: boolean; highlight: boolean; zone: NonNullable<CaptionPatch['zone']>; style: PresetPatch }
  layoutOps: Array<Extract<Op, { t: 'layout' | 'follow' | 'layoutClip' }>>
  /** Facecam-Layout-Änderungen in Reihenfolge (letzte gewinnt). */
  streamOps: Array<Extract<Op, { t: 'stream' }>>
  /** Zusätzliche Tonspuren (Soundeffekte, Musik). */
  audio: AudioClip[]
  /** Pegel des Originaltons in dB. */
  voiceDb: number
  /** Pegel einzelner Bereiche des Originaltons (Quellzeit). */
  voiceRanges: VoiceRange[]
  /** Schnittpunkte im Video (Quellzeit). */
  splits: number[]
  /** Verschobene Videostücke in Reihenfolge. */
  moves: SegMove[]
}

export const emptyLog = (clipId: string): EditLog => ({ version: 1, clipId, ops: [], cursor: 0 })

/** Globale Standardwerte (Stil-Studio → „Als Standard festlegen“, Erstellen-Dialog): Preset, Änderungen daran, Titel an/aus. */
export interface StyleDefaults { presetId?: string; style?: PresetPatch; titleEnabled?: boolean; /** Untertitel für neue Clips (Standard an). */ captionsEnabled?: boolean; /** Cold Opener: Zieldauer des Vorspanns in Sekunden (0–5, 0 = aus); wirkt beim Export auf Clips mit Vorschlag. */ coldOpenSec?: number }

export function baseState(clip: Pick<ShortmeClip, 'start' | 'end' | 'hookText'> & { corrections?: Record<number, string>; autoCuts?: ShortmeClip['autoCuts'] }, presetId = 'glow-karaoke', defaults: StyleDefaults = {}): EditState {
  return { start: clip.start, end: clip.end, cutWords: [], autoCuts: (clip.autoCuts ?? []).map((c) => ({ start: c.start, end: c.end })), hook: { text: clip.hookText, seconds: 3, enabled: !!defaults.titleEnabled }, wordEdits: { ...(clip.corrections ?? {}) }, caption: { presetId: defaults.presetId ?? presetId, enabled: defaults.captionsEnabled !== false, highlight: true, zone: 'Aus', style: defaults.style ?? {} }, layoutOps: [], streamOps: [], audio: [], voiceDb: 0, voiceRanges: [], splits: [], moves: [] }
}

/** Zustand = Basis + alle Operationen bis zum Cursor. */
export function reduce(base: EditState, ops: Op[]): EditState {
  const s: EditState = { ...base, cutWords: [...base.cutWords], autoCuts: (base.autoCuts ?? []).map((c) => ({ ...c })), hook: { ...base.hook }, wordEdits: { ...base.wordEdits }, caption: { ...base.caption, style: { ...base.caption.style } }, layoutOps: [...base.layoutOps], streamOps: [...(base.streamOps ?? [])], audio: (base.audio ?? []).map((a) => ({ ...a })), voiceDb: base.voiceDb ?? 0, voiceRanges: (base.voiceRanges ?? []).map((r) => ({ ...r })), splits: [...(base.splits ?? [])], moves: [...(base.moves ?? [])] }
  for (const op of ops) {
    switch (op.t) {
      case 'trim': s.start = Math.min(op.start, op.end - 0.5); s.end = op.end; break
      case 'cutWords': {
        const set = new Set(s.cutWords)
        for (const w of op.words) op.cut ? set.add(w) : set.delete(w)
        s.cutWords = [...set].sort((a, b) => a - b)
        break
      }
      case 'autoCuts': {
        const same = (a: { start: number; end: number }, b: { start: number; end: number }): boolean => Math.abs(a.start - b.start) < 0.01 && Math.abs(a.end - b.end) < 0.01
        if (op.cut) { for (const r of op.ranges) if (!s.autoCuts.some((c) => same(c, r))) s.autoCuts.push({ start: r.start, end: r.end }) } else s.autoCuts = s.autoCuts.filter((c) => !op.ranges.some((r) => same(c, r)))
        s.autoCuts.sort((a, b) => a.start - b.start)
        break
      }
      case 'hook': s.hook = { text: op.text ?? s.hook.text, seconds: op.seconds ?? s.hook.seconds, enabled: op.enabled ?? s.hook.enabled }; break
      case 'editWord': if (op.text.trim()) s.wordEdits[op.word] = op.text.trim(); else delete s.wordEdits[op.word]; break
      case 'caption': {
        const p = op.patch
        s.caption = { presetId: p.presetId ?? s.caption.presetId, enabled: p.enabled ?? s.caption.enabled ?? true, highlight: p.highlight ?? s.caption.highlight, zone: p.zone ?? s.caption.zone, style: p.resetStyle ? (p.style ?? {}) : deepMerge(s.caption.style, p.style ?? {}) }
        break
      }
      case 'layoutClip': s.layoutOps = []; s.layoutOps.push(op); break
      case 'stream': s.streamOps.push(op); break
      case 'audio': {
        const i = s.audio.findIndex((a) => a.id === op.id)
        if (op.remove) { if (i >= 0) s.audio.splice(i, 1) } else if (op.clip) { { if (i >= 0) s.audio[i] = { ...op.clip }; else s.audio.push({ ...op.clip }) } } else if (i >= 0 && op.patch) s.audio[i] = { ...s.audio[i], ...op.patch, gainDb: clampDb(op.patch.gainDb ?? s.audio[i].gainDb) }
        break
      }
      case 'voice': s.voiceDb = clampDb(op.gainDb); break
      case 'audioSplit': splitAudio(s, op.id, op.at, op.newId); break
      case 'split': {
        if (op.remove) { s.splits = s.splits.filter((x) => Math.abs(x - op.at) > 1e-3); break }
        // Schnitt durch alle Ebenen (wie „alle Spuren am Abspielkopf teilen“): Video im Clip + jede Tonspur, die hier läuft
        if (op.at > s.start + 0.02 && op.at < s.end - 0.02) s.splits = [...s.splits.filter((x) => Math.abs(x - op.at) > 1e-3), op.at].sort((a, b) => a - b)
        for (const a of [...s.audio]) splitAudio(s, a.id, op.at, `${a.id}.${Math.round(op.at * 1000)}`)
        break
      }
      case 'moveSeg': s.moves.push(op.move); break
      case 'voiceRange': {
        const i = s.voiceRanges.findIndex((r) => r.id === op.id)
        if (op.remove) { if (i >= 0) s.voiceRanges.splice(i, 1) } else if (op.range) { const r = { ...op.range, gainDb: clampDb(op.range.gainDb) }; if (i >= 0) s.voiceRanges[i] = r; else s.voiceRanges.push(r) } else if (i >= 0 && op.patch) s.voiceRanges[i] = { ...s.voiceRanges[i], ...op.patch, gainDb: clampDb(op.patch.gainDb ?? s.voiceRanges[i].gainDb) }
        break
      }
      case 'layout':
      case 'follow': s.layoutOps.push(op); break
    }
  }
  return s
}

export const stateOf = (base: EditState, log: EditLog): EditState => reduce(base, log.ops.slice(0, log.cursor))

/** Tonspur an Quellzeit `at` teilen (nichts, wenn `at` nicht innerhalb liegt): vorderer Teil behält die id, hinterer spielt ab dieser Stelle der Datei weiter. */
function splitAudio(s: EditState, id: string, at: number, newId: string): void {
  const i = s.audio.findIndex((a) => a.id === id)
  const a = s.audio[i]
  const cut = a ? at - a.at : 0
  if (!a || cut < 0.02 || cut > a.dur - 0.02) return
  s.audio[i] = { ...a, dur: cut }
  s.audio.splice(i + 1, 0, { ...a, id: newId, at, in: (a.in ?? 0) + cut, dur: a.dur - cut, fileDur: a.fileDur ?? (a.in ?? 0) + a.dur })
}

/** Gelöschte Stücke gelten für alle Ebenen: Tonstücke, die in einem gelöschten Bereich beginnen, sind stumm (Wiederherstellen bringt sie zurück). */
export const isAudioDeleted = (a: Pick<AudioClip, 'at'>, st: Pick<EditState, 'autoCuts'>): boolean => (st.autoCuts ?? []).some((c) => a.at >= c.start - 1e-3 && a.at < c.end - 1e-3)
export const liveAudio = (st: Pick<EditState, 'audio' | 'autoCuts'>): AudioClip[] => st.audio.filter((a) => !isAudioDeleted(a, st))

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

/** Puffer im Editor: so viele Sekunden vor und nach dem Clip lassen sich dazunehmen (Clip startet zu spät / endet zu früh). */
export const EDIT_PAD_SEC = 60
/** Sichtbarer Bereich der Editor-Zeitleiste (Quellzeit), auf die Quelle begrenzt. */
export const editWindow = (start: number, end: number, sourceSec: number): [number, number] => [Math.max(0, start - EDIT_PAD_SEC), Math.min(Math.max(end, sourceSec || end), end + EDIT_PAD_SEC)]

export interface WordT { start: number; end: number }

/** Wirksamer Clip nach den Edits: neue Wortgrenzen, Shots auf den neuen Beginn bezogen und mit Layout-/Follow-Überschreibungen. */
export function effectiveClip<C extends Pick<ShortmeClip, 'start' | 'end' | 'firstWord' | 'lastWord' | 'shots' | 'hookText'>>(clip: C, words: WordT[], st: EditState, layout?: PlanInput | null): C & { moves: SegMove[]; removed: Array<[number, number]>; wordEdits: Record<number, string> } {
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
  for (const c of st.autoCuts ?? []) if (c.end > st.start && c.start < st.end) removed.push([Math.max(c.start, st.start), Math.min(c.end, st.end)])
  // Shots auf absolute Zeit, dann Überschreibungen, dann auf neuen Beginn beziehen
  const abs = (clip.shots ?? []).map((s) => ({ ...s, start: clip.start + s.start, end: clip.start + s.end }))
  const shots = applyStreamOps(applyLayoutOps(abs, st.layoutOps, st.start, st.end, layout ? { input: layout, clipStart: clip.start } : undefined), st.streamOps ?? [], (clip as { stream?: StreamLayout }).stream).map((s) => ({ ...s, start: s.start - st.start, end: s.end - st.start }))
  return { ...clip, start: st.start, end: st.end, firstWord: first, lastWord: last, shots, hookText: st.hook.text, removed, wordEdits: st.wordEdits, moves: st.moves ?? [] }
}

/** Facecam-Layout je Stream-Szene: Grundlage = Layout der Szene, sonst das des Clips; dann die Änderungen (Clip weit, dann nur die Szene um `at`). */
export function applyStreamOps(shots: ShortmeShot[], ops: Array<Extract<Op, { t: 'stream' }>>, base?: StreamLayout): ShortmeShot[] {
  return shots.map((s) => {
    if (s.layout !== 'stream') return s
    let cur: StreamLayout | undefined = s.stream ?? base
    for (const op of ops) {
      if (op.at !== undefined && !(op.at >= s.start - 1e-6 && op.at < s.end - 1e-6)) continue
      // Änderung am ganzen Clip: Position von Facecam/Gameplay gilt nur für Szenen mit der Kanal-Facecam, nicht für Szenen mit eigener (anderer) Facecam
      let patch = op.patch
      if (op.at === undefined && base && cur && !sameCam(cur.cam, base.cam)) { const { cam: _c, game: _g, ...rest } = patch; patch = rest }
      cur = cur ? { ...cur, ...patch } : isFullStream(patch) ? patch : undefined
    }
    if (!cur) return { ...s, layout: 'fixed' as const } // ohne Facecam-Layout kein Stream-Bild
    return { ...s, stream: cur }
  })
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
