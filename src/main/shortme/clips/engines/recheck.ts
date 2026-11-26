// „Fertigen Clip mit anderer Engine prüfen“ (clip-recheck): ein vorhandener Clip samt Quellzeitspanne wird einer anderen Engine zur NEUBEWERTUNG gegeben.
// Das ist ausdrücklich keine Entdeckung (full-source-discovery) und fließt nie in „Engine X hätte das Ereignis selbst gefunden“ ein.
// Engine 2: echte Prüfung des Ausschnitts (Bild: Qwen3-VL, Ton: Voxtral) und redaktionelle Bewertung wie in der Pipeline. Engine 1 hat keine Einzelclip-Bewertung → ehrlicher Hinweis statt Scheinergebnis.
import type { ShortmeClip } from '../../../../shared/shortme'
import type { Evidence, HighlightEvent } from '../../../../shared/engineV2'
import { V2_MODELS } from './v2/revisions'
import { withAudio, withLlm, withVision } from '../../../engines'
import { loadTranscript } from '../../transcription'
import { projectFile } from '../../project'
import { splitSentences } from '../sentences'
import { observeAudio, observeVision } from './v2/observe'
import { fuseEvent, rateEvent, QUALITY_LABEL, type Quality } from './v2/judge'
import { loadMeta } from '../../project'

export interface ClipRecheck {
  kind: 'clip-recheck'
  recheckId: string
  clipId: string
  fromRunId: string
  byEngine: 'multimodal-v2' | 'legacy' | 'engine4' | 'engine-mac' | 'engine6'
  outputSha256?: string
  at: string
  status: 'done' | 'unavailable' | 'failed'
  note: string
  quality?: Quality
  qualityLabel?: string
  reasons?: string
  uncertain?: string[]
  unchecked?: string[]
  observations?: string[]
}

export async function recheckClip(hash: string, clip: ShortmeClip, fromRunId: string, byEngine: ClipRecheck['byEngine'], signal?: AbortSignal): Promise<ClipRecheck> {
  const base = { kind: 'clip-recheck' as const, recheckId: `rc-${Date.now().toString(36)}`, clipId: clip.id, fromRunId, byEngine, at: new Date().toISOString() }
  if (byEngine === 'legacy') return { ...base, status: 'unavailable', note: 'Engine 1 hat keine Einzelclip-Bewertung (sie bewertet nur Kandidaten innerhalb ihrer eigenen Suche). Es wurde nichts neu bewertet.' }
  const meta = await loadMeta(hash)
  const t = await loadTranscript(hash)
  if (!meta) return { ...base, status: 'failed', note: 'Projekt nicht gefunden' }
  if (byEngine === 'engine6') {
    if (!t) return { ...base, status: 'failed', note: 'Transkript fehlt' }
    try {
      const { recheckV6 } = await import('./v6/recheck')
      const a = await recheckV6(meta, t, clip, projectFile(hash, `analysis/rechecks/${base.recheckId}`), signal)
      return { ...base, status: 'done', note: `Neuprüfung des aktuellen Clips durch Engine 6 (Datei wie Export, ${a.coverage.packets} Prüfpakete über ${Math.round(a.coverage.observedSec)} von ${Math.round(a.coverage.outputSec)} s, Technik ${a.technicalStatus}). Keine Entdeckung.`, qualityLabel: a.status, reasons: a.criteria.map((c) => `${c.id}: ${c.state}`).join(', '), uncertain: a.criteria.filter((c) => c.state === 'unknown').map((c) => `${c.id}: ${c.reason}`), outputSha256: a.sha256, observations: a.criteria.map((c) => `${c.id}/${c.state}: ${c.reason}`.slice(0, 300)) }
    } catch (e) {
      if (signal?.aborted) throw e
      return { ...base, status: 'failed', note: `Engine-6-Recheck fehlgeschlagen: ${e instanceof Error ? e.message.slice(0, 200) : String(e)}` }
    }
  }
  if (byEngine === 'engine4' || byEngine === 'engine-mac') {
    // Engine 4: den Clip so rendern, wie er ist (seine Stücke, Untertitel, Ausschnitt), und am fertigen Ergebnis mit Bild+Ton prüfen – keine Entdeckung
    if (!t) return { ...base, status: 'failed', note: 'Transkript fehlt' }
    try {
      const dir = projectFile(hash, `analysis/rechecks/${base.recheckId}`)
      const { Tracer } = await import('./v4/trace')
      const { renderVariant, judgeRendered } = await import('./v4/finalize')
      const { withAv, withMacAv } = await import('./v3/avWorker')
      const label = byEngine === 'engine-mac' ? 'Engine Mac (Gemma 4)' : 'Engine 4'
      const { ensureSignals } = await import('../analysis')
      const signals = await ensureSignals(meta)
      const tracer = new Tracer(dir, base.recheckId, meta.hash)
      const r = await (byEngine === 'engine-mac' ? withMacAv : withAv)(base.recheckId, async (s) => {
        const rendered = await renderVariant(meta, t, signals, [], { ...clip }, `${dir}/output`, signal)
        return judgeRendered(s, rendered, { variantId: clip.id, summary: clip.v2?.summary || clip.title, wav: projectFile(hash, 'audio.wav'), hasAudio: meta.hasAudio !== false, edges: [], tracer, round: 0, signal })
      })
      const j = r.judgement
      if (!j) return { ...base, status: 'failed', note: `Endprüfung ungültig: ${r.error ?? '?'}` }
      return { ...base, status: 'done', note: `Neubewertung des fertigen Clips durch ${label} (gerenderte Datei, Bild+Ton + Messungen). Keine Entdeckung.`, qualityLabel: j.decision, reasons: j.criteria.map((c) => `${c.id}: ${c.state}`).join(', '), uncertain: j.criteria.filter((c) => c.state === 'unknown').map((c) => `${c.id}: ${c.reason}`), outputSha256: j.outputSha256, observations: j.criteria.map((c) => `${c.id}/${c.state}: ${c.reason}`.slice(0, 300)) }
    } catch (e) {
      if (signal?.aborted) throw e
      return { ...base, status: 'failed', note: `${byEngine === 'engine-mac' ? 'Engine-Mac' : 'Engine-4'}-Recheck fehlgeschlagen: ${e instanceof Error ? e.message.slice(0, 200) : String(e)}` }
    }
  }
  try {
    const sentences = splitSentences(t?.words ?? [])
    const ev: HighlightEvent = { id: 'rc', start: clip.start, end: clip.end, anchor: (clip.start + clip.end) / 2, kind: clip.v2?.kind && clip.v2.kind !== 'sonstiges' ? (clip.v2.kind as HighlightEvent['kind']) : 'sonstiges', summary: clip.v2?.summary || clip.title, foundBy: ['text'], evidenceIds: [], requiredModalities: [], missingContext: [] }
    const evidence = new Map<string, Evidence>()
    const add = (e: Evidence): void => { evidence.set(e.id, e); ev.evidenceIds.push(e.id) }
    await withVision(async (url) => { add(await observeVision(url, meta.sourcePath, ev, 'rc-v', V2_MODELS.vision, signal)) })
    if (meta.hasAudio !== false) await withAudio(async (url) => { add(await observeAudio(url, projectFile(hash, 'audio.wav'), ev, 'rc-a', V2_MODELS.audio, signal)) })
    const j = await withLlm(async (url) => rateEvent(url, await fuseEvent(url, ev, evidence, sentences, signal), evidence, sentences, null, signal))
    return { ...base, status: 'done', note: 'Neubewertung des fertigen Clips durch Engine 2 (Bild, Ton, Text). Keine Entdeckung, kein Maß für „selbst gefunden“.', quality: j.rating.quality, qualityLabel: QUALITY_LABEL[j.rating.quality], reasons: j.rating.reasons, uncertain: j.rating.uncertain, unchecked: j.rating.unchecked, observations: [...evidence.values()].map((e) => `${e.modality}/${e.state}: ${e.observation}`.slice(0, 300)) }
  } catch (e) {
    if (signal?.aborted) throw e
    return { ...base, status: 'failed', note: `Neubewertung fehlgeschlagen: ${e instanceof Error ? e.message.slice(0, 200) : String(e)}` }
  }
}
