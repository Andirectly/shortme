// Echte Beobachtung: Bilder (Qwen3-VL) und Tonausschnitte (Voxtral) werden den lokalen Modellen übergeben; das Ergebnis sind Belege mit Frame-IDs/Zeiten.
import { loadPrompt } from '../../llm'
import { audioPart, chatMm, imagePart, textPart } from './mm'
import { cutWav, grabJpeg, seamWav, windowsOver } from './media'
import { V2_LIMITS, type Evidence, type HighlightEvent } from '../../../../../shared/engineV2'

const strArr = (x: unknown): string[] => (Array.isArray(x) ? x.filter((k): k is string => typeof k === 'string' && !!k.trim()).map((k) => k.trim().slice(0, 160)).slice(0, 6) : [])
const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null)
const txt = (x: unknown): string => (typeof x === 'string' ? x.trim().slice(0, 300) : '')

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Bild

interface VisionAnswer { frames: Array<{ id: string; sichtbar: string }>; handlung: string; reaktion: string; ergebnis: string; vorlauf: boolean; text: string; unsicher: string[] }
const VISION_SCHEMA = { type: 'object', additionalProperties: false, required: ['frames', 'handlung', 'reaktion', 'ergebnis', 'vorlauf_noetig', 'sichtbarer_text', 'unsicher'], properties: { frames: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'sichtbar'], properties: { id: { type: 'string' }, sichtbar: { type: 'string' } } } }, handlung: { type: 'string' }, reaktion: { type: 'string' }, ergebnis: { type: 'string' }, vorlauf_noetig: { type: 'boolean' }, sichtbarer_text: { type: 'string' }, unsicher: { type: 'array', items: { type: 'string' } } } }

/** Bildzeitpunkte um den Höhepunkt, dichter nahe am Anker; innerhalb des Ereignisses, mindestens 1,5 s Abstand. */
export function frameTimes(ev: Pick<HighlightEvent, 'start' | 'end' | 'anchor'>, n: number = V2_LIMITS.imagesPerEvent): number[] {
  const lo = ev.start, hi = ev.end
  const offs = [-8, -3, 0, 3, 8, -14, 14].slice(0, Math.max(1, n))
  const ts = offs.map((o) => Math.min(hi - 0.3, Math.max(lo + 0.3, ev.anchor + o))).sort((a, b) => a - b)
  const out: number[] = []
  for (const t of ts) if (!out.length || t - out[out.length - 1] >= 1.5) out.push(Math.round(t * 2) / 2)
  return out.length ? out : [(lo + hi) / 2]
}

export async function observeVision(baseUrl: string, video: string, ev: HighlightEvent, id: string, modelRev: string, signal?: AbortSignal): Promise<Evidence> {
  const times = frameTimes(ev)
  const base = { id, modality: 'visual' as const, source: 'qwen3-vl-4b', start: times[0], end: times[times.length - 1], modelRev }
  try {
    const jpegs = await Promise.all(times.map((t) => grabJpeg(video, t, V2_LIMITS.imageWidth, signal)))
    const prompt = await loadPrompt('v2/vision', { summary: ev.summary || 'auffälliger Moment', frames: '' })
    const frames = times.map((t, i) => ({ id: `F${i + 1}`, t }))
    const a = await chatMm<VisionAnswer>(baseUrl, prompt.system, [textPart(`Bilder (zeitlich geordnet, ${frames.map((f) => f.id).join(', ')}):`), ...jpegs.flatMap((j, i) => [textPart(`${frames[i].id}:`), imagePart(j)])], {
      schema: VISION_SCHEMA, maxTokens: 900, signal,
      validate: (x) => {
        const o = x as Record<string, unknown>
        if (!o || !Array.isArray(o.frames)) throw new Error('frames fehlt')
        return { frames: (o.frames as Array<Record<string, unknown>>).map((f) => ({ id: txt(f.id), sichtbar: txt(f.sichtbar) })), handlung: txt(o.handlung), reaktion: txt(o.reaktion), ergebnis: txt(o.ergebnis), vorlauf: o.vorlauf_noetig === true, text: txt(o.sichtbarer_text), unsicher: strArr(o.unsicher) }
      }
    })
    const parts = [a.handlung && `Handlung: ${a.handlung}`, a.reaktion && `Reaktion: ${a.reaktion}`, a.ergebnis && `Ergebnis: ${a.ergebnis}`, a.text && `Sichtbarer Text: ${a.text}`, a.vorlauf && 'Vorlauf nötig'].filter(Boolean)
    return { ...base, state: 'observed', observation: parts.join('. ') || a.frames.map((f) => f.sichtbar).join(' / '), frames, ...(a.unsicher.length ? { uncertainty: a.unsicher.join('; ') } : {}) }
  } catch (e) {
    if (signal?.aborted) throw e
    return { ...base, state: 'failed', observation: '', uncertainty: `Bildprüfung fehlgeschlagen: ${e instanceof Error ? e.message.slice(0, 160) : e}` }
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Ton

interface AudioAnswer { art: string; bei: number | null; pStart: number | null; pEnd: number | null; reaktionen: string; stimmung: string; unsicher: string[] }
const AUDIO_SCHEMA = { type: 'object', additionalProperties: false, required: ['art', 'wechsel_bei', 'darbietung_start', 'darbietung_ende', 'reaktionen', 'stimmung', 'unsicher'], properties: { art: { type: 'string' }, wechsel_bei: { type: ['number', 'null'] }, darbietung_start: { type: ['number', 'null'] }, darbietung_ende: { type: ['number', 'null'] }, reaktionen: { type: 'string' }, stimmung: { type: 'string' }, unsicher: { type: 'array', items: { type: 'string' } } } }

/** Tonprüfung in überlappenden Fenstern (≤ 30 s); Zeiten der Antwort werden auf Quellsekunden zurückgerechnet und gegen das Fenster geprüft. */
export async function observeAudio(baseUrl: string, wav: string, ev: HighlightEvent, id: string, modelRev: string, signal?: AbortSignal): Promise<Evidence> {
  const region: [number, number] = [ev.start, Math.min(ev.end, ev.start + 90)]
  const wins = windowsOver(region[0], region[1], V2_LIMITS.audioWindowSec, V2_LIMITS.audioOverlapSec)
  const base = { id, modality: 'audio' as const, source: 'voxtral-mini-3b', start: region[0], end: region[1], modelRev }
  const lines: string[] = []
  const unsure: string[] = []
  let perf: [number, number] | null = null
  let ok = 0
  for (const [ws, we] of wins) {
    signal?.throwIfAborted()
    try {
      const dur = we - ws
      const prompt = await loadPrompt('v2/audio', { duration: dur.toFixed(0), summary: ev.summary || 'auffälliger Moment' })
      const a = await chatMm<AudioAnswer>(baseUrl, prompt.system, [audioPart(await cutWav(wav, ws, we, signal))], {
        noSystem: true, schema: AUDIO_SCHEMA, maxTokens: 500, signal,
        validate: (x) => { const o = x as Record<string, unknown>; if (!o || typeof o.art !== 'string') throw new Error('art fehlt'); return { art: txt(o.art), bei: num(o.wechsel_bei), pStart: num(o.darbietung_start), pEnd: num(o.darbietung_ende), reaktionen: txt(o.reaktionen), stimmung: txt(o.stimmung), unsicher: strArr(o.unsicher) } }
      })
      ok++
      const inWin = (t: number | null): number | null => (t !== null && t >= 0 && t <= dur + 0.5 ? ws + Math.min(t, dur) : null)
      const ps = inWin(a.pStart), pe = inWin(a.pEnd)
      if (ps !== null && pe !== null && pe > ps) perf = perf ? [Math.min(perf[0], ps), Math.max(perf[1], pe)] : [ps, pe]
      const sw = inWin(a.bei)
      lines.push(`${ws.toFixed(0)}–${we.toFixed(0)} s: ${a.art}${sw !== null ? `, Wechsel bei ${sw.toFixed(0)} s` : ''}${ps !== null && pe !== null ? `, Darbietung ${ps.toFixed(0)}–${pe.toFixed(0)} s` : ''}${a.reaktionen ? `, Reaktionen: ${a.reaktionen}` : ''}${a.stimmung ? `, ${a.stimmung}` : ''}`)
      unsure.push(...a.unsicher)
    } catch (e) { if (signal?.aborted) throw e; unsure.push(`Fenster ${ws.toFixed(0)}–${we.toFixed(0)} s fehlgeschlagen: ${e instanceof Error ? e.message.slice(0, 100) : e}`) }
  }
  if (!ok) return { ...base, state: 'failed', observation: '', uncertainty: unsure.join('; ') || 'Tonprüfung fehlgeschlagen' }
  return { ...base, state: 'observed', observation: lines.join(' | '), ...(perf ? { performance: { start: perf[0], end: perf[1] } } : {}), ...(unsure.length ? { uncertainty: [...new Set(unsure)].slice(0, 5).join('; ') } : {}) }
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Ton-Prüfung einer Schnittnaht

/** Lautstärke-Verhältnis an einer Schnittstelle: Effektivwert ±60 ms um  im Vergleich zu ±1,5 s. Kleine Werte = der Schnitt liegt in einer Pause. */
export async function seamLevel(wav: string, t: number, signal?: AbortSignal): Promise<{ ratio: number; centerRms: number }> {
  const buf = await cutWav(wav, Math.max(0, t - 1.5), t + 1.5, signal)
  const n = Math.floor((buf.length - 44) / 2)
  const at = Math.min(n - 1, Math.round((t - Math.max(0, t - 1.5)) * 16000))
  const rms = (a: number, b: number): number => { let sum = 0, c = 0; for (let i = Math.max(0, a); i < Math.min(n, b); i++) { const v = buf.readInt16LE(44 + i * 2) / 32768; sum += v * v; c++ } return c ? Math.sqrt(sum / c) : 0 }
  const center = rms(at - 960, at + 960), around = rms(0, n)
  return { ratio: around > 1e-6 ? center / around : 0, centerRms: center }
}
/** Liegt der Schnittpunkt in einer Pause? (Das Tonmodell allein konnte saubere Nähte nicht von Schnitten mitten im Wort trennen.) */
export async function seamQuiet(wav: string, t: number, signal?: AbortSignal): Promise<boolean> {
  const { ratio, centerRms } = await seamLevel(wav, t, signal)
  return ratio <= 0.45 || centerRms < 0.004
}

// Nur Wahrheitswerte: freie Textfelder ließen das Tonmodell bis zur Token-Grenze ausschweifen (gemessen, siehe docs/ENGINE_V2_STATUS.md).
interface SeamAnswer { natuerlich: boolean; abgeschnitten: boolean; unsicher: boolean }
const SEAM_SCHEMA = { type: 'object', additionalProperties: false, required: ['natuerlich', 'abgeschnitten', 'unsicher'], properties: { natuerlich: { type: 'boolean' }, abgeschnitten: { type: 'boolean' }, unsicher: { type: 'boolean' } } }

/**
 * Prüft den Übergang zwischen zwei erhaltenen Stücken am zusammengesetzten Ton: `before` Sekunden Ende des ersten + `after` Sekunden Anfang des zweiten.
 * Bestätigt ist nur eine eindeutige Antwort (natürlich, nicht abgeschnitten, nicht unsicher); alles andere heißt „nicht bestätigt“.
 */
export async function checkSeam(baseUrl: string, wav: string, endOfFirst: number, startOfSecond: number, signal?: AbortSignal, span = 3): Promise<{ confirmed: boolean; reason: string }> {
  try {
    // 1) messbar: beide Schnittpunkte müssen in einer Pause liegen
    if (!(await seamQuiet(wav, endOfFirst, signal)) || !(await seamQuiet(wav, startOfSecond, signal))) return { confirmed: false, reason: 'Schnittpunkt liegt nicht in einer Pause' }
    // 2) Tonmodell als zusätzliches Veto
    const clip = await seamWav(wav, [[Math.max(0, endOfFirst - span), endOfFirst], [startOfSecond, startOfSecond + span]], signal)
    const a = await chatMm<SeamAnswer>(baseUrl, `Du hörst einen zusammengeschnittenen Tonausschnitt: ${span} Sekunden aus dem Ende eines Stücks, direkt danach ${span} Sekunden aus dem Anfang eines späteren Stücks. Der Schnitt liegt bei Sekunde ${span}. Beantworte nur nach dem, was du hörst. Wird bei Sekunde ${span} mitten in einem Wort oder Satz abgeschnitten, klingt es abgehackt oder doppelt? natuerlich = der Übergang klingt wie ein sauberer Schnitt oder eine normale Pause. abgeschnitten = ein Wort oder Satz bricht hörbar ab. unsicher = du kannst es nicht sicher beurteilen. Antworte nur als JSON.`, [audioPart(clip)], {
      noSystem: true, schema: SEAM_SCHEMA, maxTokens: 60, signal,
      validate: (x) => { const o = x as Record<string, unknown>; if (!o || typeof o.natuerlich !== 'boolean') throw new Error('natuerlich fehlt'); return { natuerlich: o.natuerlich, abgeschnitten: o.abgeschnitten === true, unsicher: o.unsicher === true } }
    })
    return { confirmed: a.natuerlich && !a.abgeschnitten && !a.unsicher, reason: a.unsicher ? 'Modell unsicher' : a.abgeschnitten ? 'Wort/Satz bricht hörbar ab' : a.natuerlich ? 'sauberer Übergang' : 'Übergang auffällig' }
  } catch (e) {
    if (signal?.aborted) throw e
    return { confirmed: false, reason: `Nahtprüfung fehlgeschlagen: ${e instanceof Error ? e.message.slice(0, 100) : e}` }
  }
}
