// Schnittplanung der neuen Engine: eine sichere zusammenhängende Grundvariante (immer vorhanden) plus wenige gekürzte Varianten (≤ 3 erhaltene Stücke,
// chronologisch, innerhalb eines Ereignisses). Jede Variante wird am tatsächlich erhaltenen Material geprüft; unbestätigte Kürzungen werden verworfen.
import type { AsrWord } from '../../../../engines/asr/protocol'
import type { Sentence } from '../../sentences'
import { snapClip } from '../../snap'
import { chatJson, isObj, loadPrompt, str } from '../../llm'
import { evidenceLines, excerpt } from './judge'
import { sentenceLine } from './search'
import { V2_LIMITS, checkKeep, outputDuration, type EditorialPlan, type Evidence, type HighlightEvent, type Piece } from '../../../../../shared/engineV2'

export interface Variant extends EditorialPlan { kind: 'baseline' | 'cut'; notes: string[] }
export interface PlanLimits { minSec: number; maxSec: number }
/** Gesamtspanne (erstes Start bis letztes Ende) einer Variante – verhindert stundenweite Quellbereiche für eine kleine Montage. */
export const MAX_SPAN_SEC = 120

export const spanOf = (keep: Piece[]): number => keep[keep.length - 1].end - keep[0].start
export const sameKeep = (a: Piece[], b: Piece[], tol = 0.3): boolean => a.length === b.length && a.every((p, i) => Math.abs(p.start - b[i].start) < tol && Math.abs(p.end - b[i].end) < tol)

/** Plan gegen alle Grenzen prüfen (Zeiten, Stückzahl, Reihenfolge, tatsächliche Ausgabelänge, Gesamtspanne). null = gültig. */
export function checkVariant(keep: Piece[], durationSec: number, lim: PlanLimits): string | null {
  const bad = checkKeep(keep, durationSec)
  if (bad) return bad
  const out = outputDuration(keep)
  if (out < lim.minSec * 0.8) return `Ausgabe zu kurz (${out.toFixed(0)} s)`
  if (out > Math.min(V2_LIMITS.absMaxClipSec, lim.maxSec + 15)) return `Ausgabe zu lang (${out.toFixed(0)} s)`
  if (spanOf(keep) > MAX_SPAN_SEC) return `Spanne zu groß (${spanOf(keep).toFixed(0)} s)`
  return null
}

/** Sätze → Zeitstück mit kleinem Polster, nie über die Mitte der Lücke zum Nachbarsatz hinaus (Nachbarwörter bleiben unangetastet). */
export function sentencePiece(sentences: Sentence[], first: number, last: number, pad: number = V2_LIMITS.seamPadSec, durationSec = Infinity): Piece {
  const a = sentences[first], b = sentences[last], prev = sentences[first - 1], next = sentences[last + 1]
  return { start: Math.max(0, prev ? Math.max(a.start - pad, (prev.end + a.start) / 2) : a.start - pad), end: Math.min(durationSec, next ? Math.min(b.end + pad, (b.end + next.start) / 2) : b.end + pad) }
}

export interface PlanContext { words: AsrWord[]; sentences: Sentence[]; silences: Array<[number, number]>; cuts: number[]; durationSec: number }

/** Sichere zusammenhängende Grundvariante: Ereignisbereich (bei hörbarer Darbietung erweitert), auf Länge gebracht und an Wort/Satz/Stille eingerastet. */
export function baselineKeep(ev: HighlightEvent, perf: { start: number; end: number } | null, ctx: PlanContext, lim: PlanLimits): Piece[] {
  let start = ev.start, end = ev.end
  if (perf) { start = Math.min(start, perf.start - 2); end = Math.max(end, perf.end + 3) }
  const target = Math.max(lim.minSec, Math.min(lim.maxSec, end - start))
  if (end - start > lim.maxSec) { const a = Math.min(Math.max(ev.anchor, start), end); start = Math.max(start, a - 0.55 * lim.maxSec); end = Math.min(end, start + lim.maxSec) }
  if (end - start < target) { const need = target - (end - start); start -= need * 0.6; end += need * 0.4 }
  start = Math.max(0, start); end = Math.min(ctx.durationSec, end)
  const hasWords = ctx.words.some((w) => w.end > start && w.start < end)
  if (!hasWords) return [{ start, end }]
  const s = snapClip({ start, end }, { words: ctx.words, sentences: ctx.sentences, silences: ctx.silences, cuts: ctx.cuts, durationSec: ctx.durationSec, maxLen: V2_LIMITS.absMaxClipSec })
  return [{ start: s.start, end: Math.min(s.end, s.start + V2_LIMITS.absMaxClipSec) }]
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// LLM-Varianten

interface RawVariant { pieces: Array<{ first: number; last: number }>; reason: string }
const PLAN_SCHEMA = { type: 'object', additionalProperties: false, required: ['variants'], properties: { variants: { type: 'array', maxItems: 3, items: { type: 'object', additionalProperties: false, required: ['pieces', 'reason'], properties: { pieces: { type: 'array', minItems: 1, maxItems: V2_LIMITS.maxPieces, items: { type: 'object', additionalProperties: false, required: ['first', 'last'], properties: { first: { type: 'integer' }, last: { type: 'integer' } } } }, reason: { type: 'string' } } } } } }

/** Gekürzte Varianten vom Sprachmodell; ungültige (Reihenfolge, Länge, Stückzahl) werden verworfen, die Grundvariante und Dubletten ebenso. */
export async function planVariants(baseUrl: string, ev: HighlightEvent, base: Piece[], ctx: PlanContext, lim: PlanLimits, hints: string, signal?: AbortSignal): Promise<{ keeps: Array<{ keep: Piece[]; reason: string }>; rejected: string[] }> {
  const lo = base[0].start - 6, hi = base[base.length - 1].end + 6
  const window = ctx.sentences.filter((s) => s.end > lo && s.start < hi)
  if (window.length < 3) return { keeps: [], rejected: [] }
  const prompt = await loadPrompt('v2/plan', { variants: V2_LIMITS.maxVariantsPerEvent - 1, minSec: lim.minSec, maxSec: lim.maxSec, summary: ev.summary, kind: ev.kind, hints: hints || 'keine', sentences: window.map(sentenceLine).join('\n') })
  const first = window[0].index, last = window[window.length - 1].index
  const raws = await chatJson<RawVariant[]>(baseUrl, prompt, {
    schema: PLAN_SCHEMA, maxTokens: 700, temperature: 0.3, signal,
    validate: (x) => {
      if (!isObj(x) || !Array.isArray(x.variants)) throw new Error('variants fehlt')
      return x.variants.flatMap((v): RawVariant[] => {
        if (!isObj(v) || !Array.isArray(v.pieces)) return []
        const pieces = v.pieces.flatMap((p) => (isObj(p) && Number.isInteger(p.first) && Number.isInteger(p.last) ? [{ first: p.first as number, last: p.last as number }] : []))
        return pieces.length ? [{ pieces, reason: str(v.reason, 220, 'reason') }] : []
      })
    }
  })
  const keeps: Array<{ keep: Piece[]; reason: string }> = []
  const rejected: string[] = []
  for (const r of raws) {
    let bad: string | null = null
    for (let i = 0; i < r.pieces.length && !bad; i++) {
      const p = r.pieces[i]
      if (p.first < first || p.last > last || p.last < p.first) bad = `Satznummern außerhalb des Fensters`
      else if (i > 0 && p.first <= r.pieces[i - 1].last) bad = 'Stücke nicht aufsteigend'
    }
    if (bad) { rejected.push(`${r.reason.slice(0, 50)}: ${bad}`); continue }
    const keep = r.pieces.map((p) => sentencePiece(ctx.sentences, p.first, p.last, V2_LIMITS.seamPadSec, ctx.durationSec))
    const err = checkVariant(keep, ctx.durationSec, lim)
    if (err) { rejected.push(`${r.reason.slice(0, 50)}: ${err}`); continue }
    if (sameKeep(keep, base) || keeps.some((k) => sameKeep(k.keep, keep))) continue
    keeps.push({ keep, reason: r.reason })
  }
  return { keeps: keeps.slice(0, V2_LIMITS.maxVariantsPerEvent - 1), rejected }
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Prüfung am erhaltenen Material

/** Beleg zählt nur, wenn sein Zeitbereich ein erhaltenes Stück berührt (ein Beleg aus einem entfernten Abschnitt legitimiert den Schnitt nicht). */
export const evidenceInKeep = (e: Evidence, keep: Piece[]): boolean => keep.some((p) => e.end > p.start && e.start < p.end)

export const keptText = (keep: Piece[], sentences: Sentence[]): string => keep.map((p) => excerpt(sentences, p.start - 0.2, p.end + 0.2, 1800)).join('\n[Schnitt]\n')

interface Check { ok: boolean; grund: string }
interface Verdict { einstieg: Check; setup: Check; kern: Check; abschluss: Check; naht: number | null; verdict: 'verified' | 'needs-review' | 'failed' }
const chk = { type: 'object', additionalProperties: false, required: ['ok', 'grund'], properties: { ok: { type: 'boolean' }, grund: { type: 'string' } } }
const VERIFY_SCHEMA = { type: 'object', additionalProperties: false, required: ['einstieg', 'setup', 'kern', 'abschluss', 'naht', 'verdict'], properties: { einstieg: chk, setup: chk, kern: chk, abschluss: chk, naht: { type: ['integer', 'null'] }, verdict: { type: 'string', enum: ['verified', 'needs-review', 'failed'] } } }

/** Textprüfung des tatsächlich erhaltenen Materials (Einstieg, Setup, Kern, Abschluss, Nähte). Der Code verschärft das Urteil des Modells nach den Einzelprüfungen. */
export async function verifyKeep(baseUrl: string, keep: Piece[], evidence: Map<string, Evidence>, evidenceIds: string[], sentences: Sentence[], signal?: AbortSignal): Promise<{ verification: EditorialPlan['verification']; notes: string[] }> {
  const kept = evidenceIds.filter((id) => { const e = evidence.get(id); return e && evidenceInKeep(e, keep) })
  const prompt = await loadPrompt('v2/verify', { seams: keep.length - 1, text: keptText(keep, sentences), evidence: evidenceLines(kept, evidence) })
  const v = await chatJson<Verdict>(baseUrl, prompt, {
    schema: VERIFY_SCHEMA, maxTokens: 500, temperature: 0.1, signal,
    validate: (x) => {
      if (!isObj(x) || !['verified', 'needs-review', 'failed'].includes(x.verdict as string)) throw new Error('verdict ungültig')
      const c = (k: string): Check => { const o = x[k]; if (!isObj(o) || typeof o.ok !== 'boolean') throw new Error(`${k} ungültig`); return { ok: o.ok, grund: typeof o.grund === 'string' ? o.grund.slice(0, 160) : '' } }
      return { einstieg: c('einstieg'), setup: c('setup'), kern: c('kern'), abschluss: c('abschluss'), naht: Number.isInteger(x.naht) ? (x.naht as number) : null, verdict: x.verdict as Verdict['verdict'] }
    }
  })
  const notes = (['einstieg', 'setup', 'kern', 'abschluss'] as const).filter((k) => !v[k].ok).map((k) => `${k}: ${v[k].grund || 'nicht erfüllt'}`)
  // Ohne Schnitt gibt es keine Naht (das Modell darf sie nicht erfinden); Nähte nur bei gekürzten Varianten.
  const naht = keep.length > 1 ? v.naht : null
  if (naht !== null) notes.push(`Naht ${naht} unnatürlich`)
  // Pflicht im erhaltenen Material: Setup, Kern, Abschluss. Ein unklarer Einstieg allein ist ein Hinweis, kein Mangel.
  let verification: EditorialPlan['verification']
  if (!v.kern.ok || !v.abschluss.ok) verification = 'failed'
  else if (!v.setup.ok || naht !== null) verification = 'needs-review'
  else verification = 'verified'
  return { verification, notes }
}

