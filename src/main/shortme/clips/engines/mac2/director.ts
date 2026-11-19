// Engine Mac 2 – Qwen3.5-9B als Redaktion: (1) Schnittplan je Kandidat aus erlaubten, gemessenen Kanten-IDs + Titel + optionaler Cold-Opener-Moment,
// (2) Rangfolge aller Pläne im direkten Vergleich (statt Einzelnoten, die bei kleinen Modellen fast immer „gut“ lauten), (3) Inhaltsprüfung des fertigen Renders
// aus LFM-Beobachtungen des Renders + dem tatsächlich enthaltenen Text. Das Schema (llguidance) erzwingt erlaubte IDs; Regeln prüft der Host danach.
import { EVENT_KINDS, type EventKind } from '../../../../../shared/engineV2'
import type { CutEdge, Criterion, CritState, Span } from '../v4/core'
import { mlxJson, type MlxSession } from './mlxServer'

export const DIRECTOR_PROMPT_REVISION = 'mac2-director-6'
export const DIRECTOR_TIMEOUT_MS = 120_000

export interface ClipPlan { candidateId: string; decision: 'use' | 'reject'; reason: string; kind: EventKind; startEdge: string; endEdge: string; span: Span; title: string; summary: string; coldOpen: Span | null }

const PLACEHOLDER = /^<|kurzer (deutscher )?titel|^titel$|^title$|3–7 wörter|^clip$/i

export function contentGuide(contentType: string | null | undefined): string {
  const t = (contentType ?? '').toLowerCase()
  if (/podcast|talk|interview/.test(t)) return 'Podcast/Gespräch: Ein vollständiger Gedanke, eine Erkenntnis, eine Geschichte oder ein pointierter Wortwechsel reicht – eine sichtbare Handlung ist NICHT nötig.'
  if (/stream|gaming|twitch/.test(t)) return 'Stream: Ein Ereignis im Spiel/auf dem Bildschirm mit Reaktion des Streamers oder ein vollständiger, eigenständiger Kommentar.'
  return 'Vlog: Ein sichtbarer Moment (z. B. erster Biss, Reaktion, Überraschung) oder eine vollständige, eigenständige Aussage/Bewertung.'
}

export interface PlanSentence { index: number; start: number; end: number; text: string }

export function planPrompt(o: { contentType?: string | null; hint: string; observations: string; sentences: PlanSentence[]; minSec: number; maxSec: number; query?: string }): string {
  // Gleicher Regelteil zuerst, wechselnde Daten danach: der MLX-Server (APC) rechnet den gemeinsamen Anfang nur einmal je Lauf.
  // Auswahl über Satznummern statt Kanten-IDs (Sprachmodelle wählen Sätze zuverlässiger; Einrasten auf gemessene Kanten macht der Host).
  return [
    'Du bist Redakteur für Kurzvideos (9:16). Aus diesem langen Video sollen mehrere Shorts entstehen; der Abschnitt unten ist einer der Kandidaten.',
    'Baue daraus die BESTE eigenständige Version: startSentence = der Satz, mit dem man versteht, worum es geht (wo Thema/Essen/Situation eingeführt wird); endSentence = der Satz nach dem Urteil, der Pointe oder der Reaktion – nie ein Satz mitten in einem Gedanken.',
    'Ein Teil aus einer Reihe (z. B. eine von mehreren Bewertungen) ist ein guter Short, wenn Vorstellung und Urteil drin sind. Lieber vollständig als kurz.',
    contentGuide(o.contentType),
    o.query ? `Der Nutzer sucht besonders: ${o.query}` : '',
    `Länge zwischen ${o.minSec} und ${o.maxSec} s (die Sekunden stehen bei jedem Satz). Ob der Clip genommen wird, entscheiden später der Vergleich und die Prüfung des fertigen Clips – du baust nur die beste Version.`,
    'title: Titel in der Sprache des Clips, 3–7 Wörter, konkret aus dem Inhalt, keine erfundenen Superlative, keine Platzhalter. summary: ein Satz, worum es geht und was den Moment trägt.',
    '--- Kandidat ---',
    `Hinweis der Suche (kann falsch sein): ${o.hint}`,
    'Beobachtungen (Bild + Ton, vom lokalen Prüfmodell):', o.observations || '(keine)',
    'Transkript (Satznummer, Quellzeit, Originalwortlaut):',
    o.sentences.map((x) => `S${x.index} ${x.start.toFixed(1)}s: ${x.text}`).join('\n') || '(keine Sprache)'
  ].filter(Boolean).join('\n')
}

/**
 * Satzwahl → Clip: Start am Satzanfang, Ende am Satzende; Länge korrigiert der Host satzweise (zu kurz → nächste Sätze dazu, zu lang → Ende früher).
 * Kanten-IDs für Reparaturen: nächstgelegene gemessene Kante (±1,5 s), sonst Satzgrenze.
 */
export function planFromSentences(x: { kind: string; startSentence: string; endSentence: string; title: string; summary: string }, o: { candidateId: string; sentences: PlanSentence[]; edges: CutEdge[]; minSec: number; maxSec: number }): ClipPlan {
  const byId = (id: string): number => o.sentences.findIndex((q) => `S${q.index}` === id)
  let a = byId(x.startSentence), b = byId(x.endSentence)
  if (a < 0 || b < 0) throw new Error('Satz unbekannt')
  if (b < a) [a, b] = [b, a]
  let note = ''
  while (b < o.sentences.length - 1 && o.sentences[b].end - o.sentences[a].start < o.minSec) { b++; note = ' (Ende satzweise verlängert: Länge)' }
  while (b > a && o.sentences[b].end - o.sentences[a].start > o.maxSec) { b--; note = ' (Ende satzweise gekürzt: Länge)' }
  // 0,15 s Luft, aber nie bis in den Nachbarsatz (gemessen: kurze Folgewörter wie „Das“/„Ich“ landeten sonst am Clipende)
  const prev = o.sentences[a - 1], next = o.sentences[b + 1]
  const t0 = Math.max(0, o.sentences[a].start - 0.15, prev ? (prev.end + o.sentences[a].start) / 2 : 0)
  const t1 = Math.min(o.sentences[b].end + 0.15, next ? (o.sentences[b].end + next.start) / 2 : Infinity)
  if (t1 - t0 < o.minSec - 1 || t1 - t0 > o.maxSec + 2) throw new Error(`Länge ${(t1 - t0).toFixed(1)} s außerhalb ${o.minSec}–${o.maxSec} s`)
  const title = x.title.replace(/\s+/g, ' ').replace(/^["„“']+|["„“']+$/g, '').trim()
  if (title.length < 3 || title.length > 80 || PLACEHOLDER.test(title)) throw new Error(`Titel unbrauchbar: „${title}“`)
  const near = (t: number): CutEdge | undefined => o.edges.filter((e) => Math.abs(e.t - t) <= 1.5).sort((p, q) => Math.abs(p.t - t) - Math.abs(q.t - t))[0]
  const se = near(t0), ee = near(t1)
  return { candidateId: o.candidateId, decision: 'use', reason: `S${o.sentences[a].index}–S${o.sentences[b].index}${note}`, kind: (EVENT_KINDS as readonly string[]).includes(x.kind) ? (x.kind as EventKind) : 'sonstiges', startEdge: se?.id ?? `S${o.sentences[a].index}`, endEdge: ee?.id ?? `S${o.sentences[b].index}`, span: { start: t0, end: t1 }, title, summary: x.summary.trim().slice(0, 300), coldOpen: null }
}

/** Schnittplan über Satznummern; höchstens eine Korrekturanfrage (gemeinsames Zusatzbudget), danach Fehler. */
export async function planCandidate(s: MlxSession, o: { candidateId: string; prompt: string; sentences: PlanSentence[]; edges: CutEdge[]; minSec: number; maxSec: number; mayRetry: () => boolean; onRetry: () => void; signal?: AbortSignal }): Promise<{ plan: ClipPlan; raw: string; attempts: number; ms: number; usage?: { prompt_tokens?: number; completion_tokens?: number } }> {
  const ids = o.sentences.map((x) => `S${x.index}`)
  const schema = {
    type: 'object', additionalProperties: false, required: ['kind', 'startSentence', 'endSentence', 'title', 'summary'],
    properties: {
      kind: { type: 'string', enum: [...EVENT_KINDS] }, startSentence: { type: 'string', enum: ids }, endSentence: { type: 'string', enum: ids },
      title: { type: 'string', maxLength: 80 }, summary: { type: 'string', maxLength: 160 }
    }
  }
  let err = ''
  for (let attempt = 0; ; attempt++) {
    const r = await mlxJson<Parameters<typeof planFromSentences>[0]>(s, { content: attempt ? `${o.prompt}\n\nDeine letzte Antwort war ungültig: ${err}. Korrigiere genau das.` : o.prompt, schema, maxTokens: 260, timeoutMs: DIRECTOR_TIMEOUT_MS, temperature: attempt ? 0.3 : 0, signal: o.signal })
    try { return { plan: planFromSentences(r.value, o), raw: r.raw, attempts: attempt + 1, ms: r.ms, usage: r.usage } } catch (e) {
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
