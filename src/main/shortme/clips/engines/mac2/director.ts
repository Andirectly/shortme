// Engine Mac 2 – Qwen3.5-9B als Redaktion: (1) Schnittplan je Kandidat aus erlaubten, gemessenen Kanten-IDs + Titel + optionaler Cold-Opener-Moment,
// (2) Rangfolge aller Pläne im direkten Vergleich (statt Einzelnoten, die bei kleinen Modellen fast immer „gut“ lauten), (3) Inhaltsprüfung des fertigen Renders
// aus LFM-Beobachtungen des Renders + dem tatsächlich enthaltenen Text. Das Schema (llguidance) erzwingt erlaubte IDs; Regeln prüft der Host danach.
import { EVENT_KINDS, type EventKind } from '../../../../../shared/engineV2'
import type { CutEdge, Criterion, CritState, Span } from '../v4/core'
import { mlxJson, type MlxSession } from './mlxServer'

export const DIRECTOR_PROMPT_REVISION = 'mac2-director-4'
export const DIRECTOR_TIMEOUT_MS = 120_000

export interface ClipPlan { candidateId: string; decision: 'use' | 'reject'; reason: string; kind: EventKind; startEdge: string; endEdge: string; span: Span; title: string; summary: string; coldOpen: Span | null }

const PLACEHOLDER = /^<|kurzer (deutscher )?titel|^titel$|^title$|3–7 wörter|^clip$/i

export function contentGuide(contentType: string | null | undefined): string {
  const t = (contentType ?? '').toLowerCase()
  if (/podcast|talk|interview/.test(t)) return 'Podcast/Gespräch: Ein vollständiger Gedanke, eine Erkenntnis, eine Geschichte oder ein pointierter Wortwechsel reicht – eine sichtbare Handlung ist NICHT nötig.'
  if (/stream|gaming|twitch/.test(t)) return 'Stream: Ein Ereignis im Spiel/auf dem Bildschirm mit Reaktion des Streamers oder ein vollständiger, eigenständiger Kommentar.'
  return 'Vlog: Ein sichtbarer Moment (z. B. erster Biss, Reaktion, Überraschung) oder eine vollständige, eigenständige Aussage/Bewertung.'
}

/** Kanten im Fenster, nach Nähe zum Kandidaten, je Richtung begrenzt (kompakter Prompt, Schema-Enum). */
export function edgesNear(edges: CutEdge[], span: Span, pad: number, max: number): CutEdge[] {
  const a = span.start - pad, b = span.end + pad
  const ok = edges.filter((e) => e.t >= a && e.t <= b && e.kind !== 'manual')
  // bevorzugt sprachnahe Kanten (Satzende, Pause), dann Bild/Ton; gleichmäßig über das Fenster
  const rank = (e: CutEdge): number => (e.kind === 'sentence' ? 0 : e.kind === 'pause' ? 1 : e.kind === 'source-boundary' ? 1 : 2)
  return [...ok].sort((x, y) => rank(x) - rank(y) || x.t - y.t).slice(0, max).sort((x, y) => x.t - y.t)
}

export function planPrompt(o: { contentType?: string | null; hint: string; observations: string; transcript: string; starts: CutEdge[]; ends: CutEdge[]; minSec: number; maxSec: number; query?: string }): string {
  // kompakt (Prompt-Token kosten fast die ganze Zeit: gemessen ~165 Token/s Einlesen, Antwort 2–3 s): „E12@61.2s/Satz“
  const KIND: Record<string, string> = { sentence: 'Satz', pause: 'Pause', shot: 'Bild', speaker: 'Sprecher', 'source-boundary': 'Rand', action: 'Aktion', reaction: 'Reaktion', 'audio-phrase': 'Ton' }
  const fmt = (e: CutEdge): string => `${e.id}@${e.t.toFixed(1)}s/${KIND[e.kind] ?? e.kind}`
  // Gleicher Regelteil zuerst, wechselnde Daten danach: der MLX-Server (APC) rechnet den gemeinsamen Anfang nur einmal je Lauf
  return [
    'Du bist Redakteur für Kurzvideos (9:16, 15–75 s). Aus diesem langen Video sollen mehrere Shorts entstehen; der Abschnitt unten ist einer der Kandidaten.',
    'Baue daraus die BESTE eigenständige Version: Start so früh, dass man versteht, worum es geht (z. B. wo das Thema/das Essen/die Situation eingeführt wird), Ende nach dem Urteil, der Pointe oder der Reaktion. Nutze dafür das ganze Fenster – erweitere lieber, als abzulehnen.',
    'Ein Teil aus einer Reihe (z. B. eine von mehreren Bewertungen) ist ein guter Short, wenn Vorstellung und Urteil drin sind.',
    contentGuide(o.contentType),
    o.query ? `Der Nutzer sucht besonders: ${o.query}` : '',
    `Regeln: Länge zwischen ${o.minSec} und ${o.maxSec} s. Der Clip muss mit dem Satz beginnen, der den Moment verständlich macht, und nach der Pointe/Reaktion bzw. dem Satzende aufhören – nicht mitten im Satz.`,
    'Wähle Start/Ende NUR aus den erlaubten Kanten-IDs. decision=reject NUR, wenn auch mit allen erlaubten Kanten kein verständlicher Clip möglich ist (reiner Übergang, nichts passiert oder gesagt); dann trotzdem gültige Kanten angeben.',
    'title: Titel in der Sprache des Clips, 3–7 Wörter, konkret aus dem Inhalt (z. B. was passiert oder gesagt wird), keine erfundenen Superlative, keine Platzhalter.',
    'summary: ein Satz, worum es geht.',
    '--- Kandidat ---',
    `Hinweis der Suche (kann falsch sein): ${o.hint}`,
    'Beobachtungen (Bild + Ton, vom lokalen Prüfmodell, mit Beleg-IDs):', o.observations || '(keine)',
    'Transkript (Satznummer, Quellzeit, Originalwortlaut):', o.transcript || '(keine Sprache)',
    `Erlaubte START-Kanten (Quellzeit): ${o.starts.map(fmt).join(', ')}`,
    `Erlaubte END-Kanten (Quellzeit): ${o.ends.map(fmt).join(', ')}`
  ].filter(Boolean).join('\n')
}

export function validatePlan(x: { decision: string; reason: string; kind: string; startEdge: string; endEdge: string; title: string; summary: string }, o: { candidateId: string; edges: Map<string, CutEdge>; minSec: number; maxSec: number; starts?: CutEdge[]; ends?: CutEdge[] }): ClipPlan {
  const s = o.edges.get(x.startEdge)
  let e = o.edges.get(x.endEdge)
  if (!s || !e) throw new Error('Kante unbekannt')
  // Länge durch den Host auf die nächste erlaubte Kante korrigieren (Modell entscheidet Inhalt, das Programm die Regeln): zu kurz → spätere Endkante, zu lang → frühere
  const d0 = e.t - s.t
  if ((d0 < o.minSec - 1 || d0 > o.maxSec + 2) && o.ends?.length) {
    const fit = o.ends.filter((k) => k.t - s.t >= o.minSec - 1 && k.t - s.t <= o.maxSec + 2)
    if (fit.length) { const target = d0 < o.minSec ? fit[0] : fit[fit.length - 1]; e = target; x = { ...x, endEdge: target.id, reason: `${x.reason} (Ende auf ${target.id} korrigiert: Länge)` } }
  }
  const span = { start: s.t, end: e.t }
  const d = span.end - span.start
  if (d < o.minSec - 1 || d > o.maxSec + 2) throw new Error(`Länge ${d.toFixed(1)} s außerhalb ${o.minSec}–${o.maxSec} s`)
  const title = x.title.replace(/\s+/g, ' ').replace(/^["„“']+|["„“']+$/g, '').trim()
  if (title.length < 3 || title.length > 80 || PLACEHOLDER.test(title)) throw new Error(`Titel unbrauchbar: „${title}“`)
  // Cold Opener setzt der Host aus beobachteten Ereignissen (coldOpenFromObs); gemessen: Qwen wählte als „Moment“ immer den Clipanfang
  const coldOpen: Span | null = null
  return { candidateId: o.candidateId, decision: x.decision === 'use' ? 'use' : 'reject', reason: x.reason.trim().slice(0, 300), kind: (EVENT_KINDS as readonly string[]).includes(x.kind) ? (x.kind as EventKind) : 'sonstiges', startEdge: x.startEdge, endEdge: x.endEdge, span, title, summary: x.summary.trim().slice(0, 300), coldOpen }
}

/** Schnittplan; höchstens eine Korrekturanfrage (gemeinsames Zusatzbudget), danach Fehler. */
export async function planCandidate(s: MlxSession, o: { candidateId: string; prompt: string; starts: CutEdge[]; ends: CutEdge[]; edges: Map<string, CutEdge>; minSec: number; maxSec: number; mayRetry: () => boolean; onRetry: () => void; signal?: AbortSignal }): Promise<{ plan: ClipPlan; raw: string; attempts: number; ms: number; usage?: { prompt_tokens?: number; completion_tokens?: number } }> {
  const schema = {
    type: 'object', additionalProperties: false, required: ['decision', 'reason', 'kind', 'startEdge', 'endEdge', 'title', 'summary'],
    properties: {
      decision: { type: 'string', enum: ['use', 'reject'] }, reason: { type: 'string', maxLength: 160 }, kind: { type: 'string', enum: [...EVENT_KINDS] },
      startEdge: { type: 'string', enum: o.starts.map((e) => e.id) }, endEdge: { type: 'string', enum: o.ends.map((e) => e.id) },
      title: { type: 'string', maxLength: 80 }, summary: { type: 'string', maxLength: 160 }
    }
  }
  let err = ''
  for (let attempt = 0; ; attempt++) {
    const r = await mlxJson<Parameters<typeof validatePlan>[0]>(s, { content: attempt ? `${o.prompt}\n\nDeine letzte Antwort war ungültig: ${err}. Korrigiere genau das.` : o.prompt, schema, maxTokens: 450, timeoutMs: DIRECTOR_TIMEOUT_MS, temperature: attempt ? 0.3 : 0, signal: o.signal })
    try { return { plan: validatePlan(r.value, { ...o, starts: o.starts, ends: o.ends }), raw: r.raw, attempts: attempt + 1, ms: r.ms, usage: r.usage } } catch (e) {
      err = e instanceof Error ? e.message : String(e)
      if (!o.mayRetry()) throw new Error(`Schnittplan ungültig: ${err}`, { cause: e })
      o.onRetry()
    }
  }
}

/** Rangfolge im direkten Vergleich: alle Plan-IDs genau einmal, beste zuerst. */
export async function rankPlans(s: MlxSession, plans: Array<{ id: string; title: string; summary: string; kind: string; durationSec: number; evidence: string }>, o: { contentType?: string | null; signal?: AbortSignal }): Promise<{ order: string[]; raw: string }> {
  if (plans.length <= 1) return { order: plans.map((p) => p.id), raw: '' }
  const ids = plans.map((p) => p.id)
  const prompt = [
    'Ordne diese Kurzvideo-Vorschläge aus demselben Video nach Qualität als eigenständiger Short (bester zuerst).',
    contentGuide(o.contentType),
    'Kriterien: Versteht man ihn ohne Vorwissen? Gibt es eine Pointe, Reaktion oder eine klare Aussage? Packt der Anfang sofort? Belege zählen mehr als Behauptungen.',
    ...plans.map((p) => `${p.id}: „${p.title}“ (${p.kind}, ${p.durationSec.toFixed(0)} s) – ${p.summary}\n   Belege: ${p.evidence}`),
    'Antworte mit allen IDs genau einmal in der Reihenfolge.'
  ].join('\n')
  const schema = { type: 'object', additionalProperties: false, required: ['order'], properties: { order: { type: 'array', minItems: ids.length, maxItems: ids.length, items: { type: 'string', enum: ids } } } }
  const r = await mlxJson<{ order: string[] }>(s, { content: prompt, schema, maxTokens: 400, timeoutMs: DIRECTOR_TIMEOUT_MS, signal: o.signal })
  const seen = new Set<string>()
  const order = r.value.order.filter((id) => ids.includes(id) && !seen.has(id) && seen.add(id))
  // fehlende IDs (Schema erlaubt Doppelte) hinten anhängen, statt still zu verlieren
  for (const id of ids) if (!seen.has(id)) order.push(id)
  return { order, raw: r.raw }
}

export const MODEL_CRITERIA = ['hook', 'standalone', 'payoff', 'natural-end', 'essential-event'] as const

/** Inhaltsprüfung des fertigen Renders. Belege: Render-Segment-IDs oder „transcript“. Ohne Beleg kein „pass“. */
export async function judgeRender(s: MlxSession, o: { title: string; durationSec: number; contentType?: string | null; spoken: string; observations: string; evidenceIds: string[]; signal?: AbortSignal }): Promise<{ criteria: Criterion[]; titleOk: boolean; betterTitle: string; raw: string }> {
  const ev = [...o.evidenceIds, 'transcript']
  const prompt = [
    'Prüfe einen FERTIGEN Kurzclip. Grundlage sind nur die Beobachtungen der Ausgabedatei und der darin gesprochene Text – nicht, warum er ausgewählt wurde.',
    contentGuide(o.contentType),
    'Bewerte genau diese 5 Kriterien mit pass, fail oder unknown:',
    'hook = die ersten 3 Sekunden machen klar, warum man weiterschauen soll; standalone = ohne Vorwissen verständlich (wer, was, Bezüge); payoff = Pointe, Reaktion, Ergebnis oder die Kernaussage ist enthalten;',
    'natural-end = endet nach einem Satz-/Handlungsende, nicht abgeschnitten; essential-event = das Wesentliche (Ereignis ODER Aussage) ist vollständig drin.',
    'pass nur mit Beleg (Segment-ID oder "transcript"). Wenn die Belege nicht reichen: unknown. Sei streng: im Zweifel nicht pass.',
    'titleOk: passt der Titel zum tatsächlichen Inhalt? betterTitle: falls nicht, ein besserer (3–7 Wörter, Sprache des Clips), sonst leer.',
    '--- Clip ---',
    `Länge ${o.durationSec.toFixed(1)} s, Titel „${o.title}“.`,
    'Gesprochener Text in der Ausgabe (Clipzeit):', o.spoken || '(keine Sprache)',
    'Beobachtungen der Ausgabedatei (Bild + Ton, Clipzeit, Beleg-IDs):', o.observations || '(keine)'
  ].join('\n')
  const schema = {
    type: 'object', additionalProperties: false, required: ['criteria', 'titleOk', 'betterTitle'],
    properties: {
      criteria: { type: 'array', minItems: 5, maxItems: 5, items: { type: 'object', additionalProperties: false, required: ['id', 'state', 'reason', 'evidenceIds'], properties: { id: { type: 'string', enum: [...MODEL_CRITERIA] }, state: { type: 'string', enum: ['pass', 'fail', 'unknown'] }, reason: { type: 'string', maxLength: 120 }, evidenceIds: { type: 'array', maxItems: 4, items: { type: 'string', enum: ev } } } } },
      titleOk: { type: 'boolean' }, betterTitle: { type: 'string', maxLength: 80 }
    }
  }
  const r = await mlxJson<{ criteria: Array<{ id: string; state: CritState; reason: string; evidenceIds: string[] }>; titleOk: boolean; betterTitle: string }>(s, { content: prompt, schema, maxTokens: 700, timeoutMs: DIRECTOR_TIMEOUT_MS, signal: o.signal })
  // jedes Kriterium genau einmal; doppelte/fehlende → unknown (nie still pass)
  const criteria: Criterion[] = MODEL_CRITERIA.map((id) => {
    const c = r.value.criteria.find((x) => x.id === id)
    if (!c) return { id, state: 'unknown', reason: 'vom Modell nicht bewertet', evidenceIds: [] }
    const state: CritState = c.state === 'pass' && !c.evidenceIds.length ? 'unknown' : c.state
    return { id, state, reason: (c.reason || 'ohne Begründung').slice(0, 300), evidenceIds: c.evidenceIds }
  })
  const better = r.value.betterTitle.replace(/\s+/g, ' ').trim()
  return { criteria, titleOk: r.value.titleOk, betterTitle: better && !PLACEHOLDER.test(better) && better.length >= 3 ? better : '', raw: r.raw }
}
