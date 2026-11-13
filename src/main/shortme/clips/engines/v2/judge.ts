// Ereigniskarte und Bewertung: Fusion von Text/Ton/Bild-Belegen, danach inhaltsspezifische Bewertung (Ereignisqualität, nicht Schnittqualität).
// Fehlender Ton-/Bildbeleg ergibt „ungeprüft“ – keine erfundene Pointe und keine Null-Note. Zitate werden wörtlich gegen den Text geprüft.
import type { Sentence } from '../../sentences'
import { chatJson, isObj, loadPrompt, str } from '../../llm'
import { quoteOk } from '../../select'
import { EVENT_KINDS, isEventKind, type Evidence, type EvidenceModality, type EventKind, type HighlightEvent } from '../../../../../shared/engineV2'

export type Quality = 'schwach' | 'solide' | 'stark' | 'aussergewoehnlich' | 'ungeprueft'
export const QUALITY_LABEL: Record<Quality, string> = { schwach: 'schwach', solide: 'solide', stark: 'stark', aussergewoehnlich: 'außergewöhnlich', ungeprueft: 'ungeprüft' }
export type RateType = 'aussage' | 'unterhaltung' | 'performance' | 'gaming'

export const CRITERIA: Record<RateType, string[]> = {
  aussage: ['erkenntnis', 'geschichte', 'verstaendlich', 'relevanz'],
  unterhaltung: ['ueberraschung', 'humor', 'interaktion', 'timing', 'abschluss'],
  performance: ['besonderheit', 'verlauf', 'kontext', 'abschluss'],
  gaming: ['spielereignis', 'spannung', 'ergebnis', 'reaktion']
}

export interface Rating { type: RateType; criteria: Record<string, number | null>; quality: Quality; quote: string; quoteVerified: boolean; reasons: string; uncertain: string[]; unchecked: EvidenceModality[] }
export interface Judged { event: HighlightEvent; rating: Rating }

/** Bewertungsart: Ereignisart und Inhaltstyp des Videos entscheiden gemeinsam (Stream-Aussagen sind Unterhaltung, keine Podcast-Erkenntnis). */
export function rateType(kind: EventKind, foundBy: EvidenceModality[], contentType: string | null | undefined): RateType {
  const stream = contentType === 'stream'
  if (kind === 'performance') return 'performance'
  if (kind === 'gameplay') return 'gaming'
  if (kind === 'witz' || kind === 'reaktion' || kind === 'konflikt') return 'unterhaltung'
  if (kind === 'sonstiges' && stream && foundBy.length === 1 && foundBy[0] === 'visual') return 'gaming'
  return stream ? 'unterhaltung' : 'aussage'
}

/** Welche Beobachtungswege braucht der Moment, um beurteilt werden zu können? */
export function requiredModalities(kind: EventKind, foundBy: EvidenceModality[]): EvidenceModality[] {
  const s = new Set<EvidenceModality>()
  if (kind === 'performance' || foundBy.includes('audio')) s.add('audio')
  if (kind === 'gameplay' || foundBy.includes('visual')) s.add('visual')
  if (foundBy.includes('text') || !s.size) s.add('text')
  return [...s]
}

/** Nicht erfolgreich geprüfte Pflichtwege: ein Weg gilt nur mit einem Beleg im Zustand „observed“ als geprüft. */
export function uncheckedOf(ev: HighlightEvent, evidence: Map<string, Evidence>): EvidenceModality[] {
  return ev.requiredModalities.filter((m) => !ev.evidenceIds.some((id) => { const e = evidence.get(id); return e && e.modality === m && e.state === 'observed' }))
}

export const evidenceLines = (ids: string[], evidence: Map<string, Evidence>): string => ids.map((id) => evidence.get(id)).filter((e): e is Evidence => !!e).map((e) => `[${e.id}] ${e.modality} ${e.state === 'observed' ? 'geprüft' : e.state === 'signal-only' ? 'nur Signal' : e.state === 'failed' ? 'FEHLGESCHLAGEN' : 'nicht geprüft'} ${e.start.toFixed(0)}–${e.end.toFixed(0)} s: ${e.observation || '–'}${e.uncertainty ? ` (unsicher: ${e.uncertainty})` : ''}`).join('\n') || '(keine Belege)'

/** Transkript-Auszug [start, end] aus den Sätzen; leer = keine Sprache. */
export function excerpt(sentences: Sentence[], start: number, end: number, maxChars = 2400): string {
  const t = sentences.filter((s) => s.end > start && s.start < end).map((s) => `S${s.index}: ${s.text}`).join('\n')
  return t ? t.slice(0, maxChars) : '(keine Sprache erkannt)'
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Fusion

interface Fused { kind: EventKind; summary: string; missing: string[]; needs: EvidenceModality[]; evidenceIds: string[] }
const MODS = ['text', 'audio', 'visual', 'chat'] as const
const FUSE_SCHEMA = { type: 'object', additionalProperties: false, required: ['kind', 'summary', 'missing_context', 'needs', 'unchecked', 'evidence_ids'], properties: { kind: { type: 'string', enum: [...EVENT_KINDS] }, summary: { type: 'string' }, missing_context: { type: 'array', items: { type: 'string' } }, needs: { type: 'array', items: { type: 'string', enum: [...MODS] } }, unchecked: { type: 'array', items: { type: 'string', enum: [...MODS] } }, evidence_ids: { type: 'array', items: { type: 'string' } } } }

/** Ereigniskarte: das Modell ordnet Art, Zusammenfassung und fehlenden Kontext; die Prüfliste („unchecked“) bestimmt der Code aus den Belegzuständen, nicht das Modell. */
export async function fuseEvent(baseUrl: string, ev: HighlightEvent, evidence: Map<string, Evidence>, sentences: Sentence[], signal?: AbortSignal): Promise<HighlightEvent> {
  const prompt = await loadPrompt('v2/fuse', { start: ev.start.toFixed(0), end: ev.end.toFixed(0), summary: ev.summary || '(ohne Zusammenfassung)', kind: ev.kind, foundBy: ev.foundBy.join(', '), text: excerpt(sentences, ev.start, ev.end), evidence: evidenceLines(ev.evidenceIds, evidence) })
  try {
    const f = await chatJson<Fused>(baseUrl, prompt, {
      schema: FUSE_SCHEMA, maxTokens: 600, temperature: 0.2, signal,
      validate: (x) => {
        if (!isObj(x) || !isEventKind(x.kind)) throw new Error('kind ungültig')
        const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((k): k is string => typeof k === 'string') : [])
        return { kind: x.kind, summary: str(x.summary, 260, 'summary'), missing: strs(x.missing_context).slice(0, 6), needs: strs(x.needs).filter((m): m is EvidenceModality => (MODS as readonly string[]).includes(m)), evidenceIds: strs(x.evidence_ids).filter((id) => ev.evidenceIds.includes(id)) }
      }
    })
    const required = [...new Set([...requiredModalities(f.kind, ev.foundBy), ...f.needs.filter((m) => m !== 'chat')])]
    return { ...ev, kind: f.kind, summary: f.summary, missingContext: f.missing, requiredModalities: required, evidenceIds: f.evidenceIds.length ? [...new Set([...f.evidenceIds, ...ev.evidenceIds.filter((id) => evidence.get(id)?.state === 'observed')])] : ev.evidenceIds }
  } catch (e) {
    if (signal?.aborted) throw e
    // Fusion fehlgeschlagen: Ereignis bleibt mit den Rohangaben erhalten (kein Verwerfen), Pflichtwege aus der Regel
    return { ...ev, requiredModalities: requiredModalities(ev.kind, ev.foundBy) }
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Bewertung

const RATE_FILE: Record<RateType, string> = { aussage: 'v2/rate-aussage', unterhaltung: 'v2/rate-unterhaltung', performance: 'v2/rate-performance', gaming: 'v2/rate-gaming' }
const QUALS: Quality[] = ['schwach', 'solide', 'stark', 'aussergewoehnlich']
const rateSchema = (type: RateType): object => ({
  type: 'object', additionalProperties: false, required: ['criteria', 'quality', 'text_quote', 'reasons', 'unsicher'],
  properties: {
    criteria: { type: 'object', additionalProperties: false, required: CRITERIA[type], properties: Object.fromEntries(CRITERIA[type].map((k) => [k, { type: ['integer', 'null'], minimum: 0, maximum: 3 }])) },
    quality: { type: 'string', enum: QUALS }, text_quote: { type: 'string' }, reasons: { type: 'string' }, unsicher: { type: 'array', items: { type: 'string' } }
  }
})

export async function rateEvent(baseUrl: string, ev: HighlightEvent, evidence: Map<string, Evidence>, sentences: Sentence[], contentType: string | null | undefined, signal?: AbortSignal): Promise<Judged> {
  const type = rateType(ev.kind, ev.foundBy, contentType)
  const text = excerpt(sentences, ev.start, ev.end)
  const unchecked = uncheckedOf(ev, evidence)
  const prompt = await loadPrompt(RATE_FILE[type], { start: ev.start.toFixed(0), end: ev.end.toFixed(0), kind: ev.kind, summary: ev.summary, missing: ev.missingContext.join('; ') || 'nichts', text, evidence: evidenceLines(ev.evidenceIds, evidence) })
  const empty = (why: string): Judged => ({ event: ev, rating: { type, criteria: Object.fromEntries(CRITERIA[type].map((k) => [k, null])), quality: 'ungeprueft', quote: '', quoteVerified: false, reasons: '', uncertain: [why], unchecked } })
  try {
    const r = await chatJson<{ criteria: Record<string, number | null>; quality: Quality; quote: string; reasons: string; uncertain: string[] }>(baseUrl, prompt, {
      schema: rateSchema(type), maxTokens: 500, temperature: 0.2, signal,
      validate: (x) => {
        if (!isObj(x) || !isObj(x.criteria) || !QUALS.includes(x.quality as Quality)) throw new Error('Bewertung ungültig')
        const c: Record<string, number | null> = {}
        for (const k of CRITERIA[type]) { const v = (x.criteria as Record<string, unknown>)[k]; c[k] = typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(3, Math.round(v))) : null }
        return { criteria: c, quality: x.quality as Quality, quote: typeof x.text_quote === 'string' ? x.text_quote.trim() : '', reasons: typeof x.reasons === 'string' ? x.reasons.trim().slice(0, 300) : '', uncertain: Array.isArray(x.unsicher) ? x.unsicher.filter((k): k is string => typeof k === 'string').slice(0, 5) : [] }
      }
    })
    const uncertain = [...r.uncertain]
    let quality: Quality = r.quality
    const quoteVerified = !r.quote || quoteOk(r.quote, text)
    if (!quoteVerified) { uncertain.push('Zitat steht nicht wörtlich im Text'); if (quality === 'aussergewoehnlich') quality = 'stark' }
    if (unchecked.length) { quality = 'ungeprueft'; uncertain.push(`nicht geprüft: ${unchecked.join(', ')}`) }
    return { event: ev, rating: { type, criteria: r.criteria, quality, quote: quoteVerified ? r.quote : '', quoteVerified, reasons: r.reasons, uncertain, unchecked } }
  } catch (e) {
    if (signal?.aborted) throw e
    return empty(`Bewertung fehlgeschlagen: ${e instanceof Error ? e.message.slice(0, 120) : e}`)
  }
}

/** Verteilung der Qualitätsklassen (Diagnose: keine Scheingenauigkeit, Gleichstände sichtbar). */
export function qualityHistogram(j: Judged[]): Record<Quality, number> {
  const h: Record<Quality, number> = { schwach: 0, solide: 0, stark: 0, aussergewoehnlich: 0, ungeprueft: 0 }
  for (const x of j) h[x.rating.quality]++
  return h
}
