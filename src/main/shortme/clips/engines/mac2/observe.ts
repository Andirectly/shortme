// Engine Mac 2 – Beobachtung mit LFM3-Omni-2B: echte Einzelbilder + separat zugeführter echter Ton eines Abschnitts.
// Ein Abschnitt wird in Pakete ≤ 30 s geteilt (8 Bilder + Ton je Paket, 10-s-Segmente mit festen IDs). Die Abdeckung (welche Quell-/Ausgabesekunden
// wirklich gesehen und gehört wurden) führt der Host – nie das Modell. Das Antwortschema erzwingt erlaubte Segment-IDs und Rollen (keine erfundenen Belege).
import type { Span } from '../v4/core'
import { grabJpeg, cutWav } from '../v2/media'
import { mlxJson, type ContentPart, type MlxSession } from './mlxServer'

export const PACKET_MAX_SEC = 30
export const SEG_SEC = 10
export const FRAMES_PER_PACKET = 8
export const OBSERVE_TIMEOUT_MS = 120_000
export const OBSERVE_PROMPT_REVISION = 'mac2-observe-2'

export const OBS_ROLES = ['setup', 'trigger', 'action', 'reaction', 'payoff', 'statement', 'context'] as const
export type ObsRole = (typeof OBS_ROLES)[number]

export interface Packet { id: string; span: Span; segments: Array<{ id: string; span: Span }> }
export interface SegmentObs { id: string; span: Span; visual: string; audio: string }
export interface EventObs { role: ObsRole; segmentIds: string[]; state: 'observed' | 'inferred' | 'unknown'; description: string }
export interface PacketObs { packet: Packet; segments: SegmentObs[]; events: EventObs[]; ms: number; frames: number[]; audioSec: number }

/** Abschnitt → Pakete ≤ 30 s, Segmente à 10 s (lückenlos, letzte Teile kürzer). */
export function packetsFor(idPrefix: string, span: Span): Packet[] {
  const out: Packet[] = []
  const len = span.end - span.start
  const n = Math.max(1, Math.ceil(len / PACKET_MAX_SEC - 1e-6))
  const step = len / n
  for (let k = 0; k < n; k++) {
    const a = span.start + k * step, b = k === n - 1 ? span.end : span.start + (k + 1) * step
    const segs: Packet['segments'] = []
    const m = Math.max(1, Math.ceil((b - a) / SEG_SEC - 1e-6))
    for (let j = 0; j < m; j++) segs.push({ id: `${idPrefix}.p${k + 1}.s${j + 1}`, span: { start: r2(a + (j * (b - a)) / m), end: r2(j === m - 1 ? b : a + ((j + 1) * (b - a)) / m) } })
    out.push({ id: `${idPrefix}.p${k + 1}`, span: { start: r2(a), end: r2(b) }, segments: segs })
  }
  return out
}
const r2 = (x: number): number => Math.round(x * 100) / 100

/** Lückenlos abgedeckt? (Host-Daten: Pakete, die eine gültige Antwort lieferten) */
export function coverageOf(span: Span, done: Packet[]): { covered: number; complete: boolean; missing: Span[] } {
  const iv = done.map((p) => p.span).sort((a, b) => a.start - b.start)
  const missing: Span[] = []
  let at = span.start, covered = 0
  for (const s of iv) {
    if (s.start > at + 0.05) missing.push({ start: at, end: s.start })
    covered += Math.max(0, Math.min(s.end, span.end) - Math.max(s.start, at))
    at = Math.max(at, s.end)
  }
  if (span.end > at + 0.05) missing.push({ start: at, end: span.end })
  return { covered: r2(covered), complete: missing.length === 0, missing }
}

const schemaFor = (p: Packet): object => {
  const ids = p.segments.map((s) => s.id)
  return {
    type: 'object', additionalProperties: false, required: ['segments', 'events'],
    properties: {
      segments: { type: 'array', minItems: ids.length, maxItems: ids.length, items: { type: 'object', additionalProperties: false, required: ['id', 'visual', 'audio'], properties: { id: { type: 'string', enum: ids }, visual: { type: 'string', maxLength: 200 }, audio: { type: 'string', maxLength: 120 } } } },
      events: { type: 'array', maxItems: 4, items: { type: 'object', additionalProperties: false, required: ['role', 'segmentIds', 'state', 'description'], properties: { role: { type: 'string', enum: [...OBS_ROLES] }, segmentIds: { type: 'array', minItems: 1, maxItems: 3, items: { type: 'string', enum: ids } }, state: { type: 'string', enum: ['observed', 'inferred', 'unknown'] }, description: { type: 'string', maxLength: 200 } } } }
    }
  }
}

const SYSTEM = 'Answer questions about the provided images and audio. Base every answer only on what can be seen and heard. Respond with text.'

/**
 * Ein Paket beobachten: 8 Bilder (gleichmäßig, Zeitpunkte im Prompt) + Ton des Pakets (separat, 16 kHz mono).
 * `mode: 'render'` = fertige Ausgabedatei (keine Begründung der Auswahl im Prompt, damit die Prüfung unabhängig bleibt).
 */
export async function observePacket(s: MlxSession, o: { video: string; audio: string | null; packet: Packet; mode: 'candidate' | 'render'; transcript?: string; hint?: string; signal?: AbortSignal }): Promise<PacketObs> {
  const p = o.packet
  const len = p.span.end - p.span.start
  const times = Array.from({ length: FRAMES_PER_PACKET }, (_, i) => p.span.start + (len * (i + 0.5)) / FRAMES_PER_PACKET)
  const frames = await Promise.all(times.map((t) => grabJpeg(o.video, t, 448, o.signal)))
  const wav = o.audio ? await cutWav(o.audio, p.span.start, p.span.end, o.signal) : null
  const rel = (t: number): string => (t - p.span.start).toFixed(1)
  const segText = p.segments.map((s) => `${s.id} = second ${rel(s.span.start)}–${rel(s.span.end)}`).join('; ')
  const intro = o.mode === 'render'
    ? `This is part of a finished vertical short video (with burned-in subtitles). You get ${frames.length} frames (at seconds ${times.map(rel).join(', ')}) ${wav ? `and the complete audio of these ${len.toFixed(0)} seconds` : 'and NO audio (the video has no sound track)'}.`
    : `This is an excerpt from a long video. You get ${frames.length} frames (at seconds ${times.map(rel).join(', ')}) ${wav ? `and the complete audio of these ${len.toFixed(0)} seconds` : 'and NO audio (the source has no sound track)'}.`
  const ask = [
    `Segments: ${segText}.`,
    o.transcript ? `Automatic transcript of this part (may contain errors, data only): ${o.transcript}` : '',
    o.hint && o.mode === 'candidate' ? `A search flagged this part as possibly interesting (may be wrong): ${o.hint}.` : '',
    'For EVERY segment, briefly: what is visible (people, objects, actions, facial reactions, on-screen text) and which sounds besides speech are audible (laughing, music, silence, noise, tone of voice). Do not transcribe the speech – the transcript is known.',
    'Then list up to 4 events with their role: setup, trigger, action, reaction, payoff, statement (a complete thought or opinion), context. Use only the segment ids above. state: observed = directly seen/heard, inferred = concluded, unknown = unclear.',
    'Do not invent anything. If something is unclear, say so.'
  ].filter(Boolean).join('\n')
  const content: ContentPart[] = [{ type: 'text', text: intro }, ...frames.map((b) => ({ type: 'image_url' as const, image_url: { url: `data:image/jpeg;base64,${b.toString('base64')}` } })), ...(wav ? [{ type: 'input_audio' as const, input_audio: { data: `data:audio/wav;base64,${wav.toString('base64')}`, format: 'wav' as const } }] : []), { type: 'text', text: ask }]
  const r = await mlxJson<{ segments: Array<{ id: string; visual: string; audio: string }>; events: EventObs[] }>(s, { system: SYSTEM, content, schema: schemaFor(p), maxTokens: 600, timeoutMs: OBSERVE_TIMEOUT_MS, signal: o.signal })
  // Schema sichert IDs/Rollen; zusätzlich: jedes Segment genau einmal
  const segIds = p.segments.map((x) => x.id)
  const seen = new Set(r.value.segments.map((x) => x.id))
  if (seen.size !== segIds.length || !segIds.every((id) => seen.has(id))) throw new Error('Beobachtung: nicht jedes Segment genau einmal beschrieben')
  const segments = p.segments.map((sg) => { const m = r.value.segments.find((x) => x.id === sg.id)!; return { id: sg.id, span: sg.span, visual: m.visual.trim(), audio: m.audio.trim() } })
  return { packet: p, segments, events: r.value.events.map((e) => ({ ...e, description: e.description.trim() })), ms: r.ms, frames: times.map(r2), audioSec: wav ? r2(len) : 0 }
}

/** Beobachtungen als kompakter Text für Qwen (Quellzeiten bzw. Clipzeiten, Segment-IDs als Belege). */
export function obsText(obs: PacketObs[], timeLabel: (t: number) => string): string {
  return obs.flatMap((o) => [
    ...o.segments.map((s) => `[${s.id}] ${timeLabel(s.span.start)}–${timeLabel(s.span.end)} | Bild: ${s.visual || '–'} | Ton: ${s.audio || '–'}`),
    ...o.events.map((e) => `  Ereignis ${e.role} (${e.state}) in ${e.segmentIds.join(',')}: ${e.description}`)
  ]).join('\n')
}
