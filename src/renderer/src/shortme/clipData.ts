import { isV4Pipeline } from '@shared/engine'
import type { ShortmeClip, ShortmeClips } from '@shared/shortme'
import { CLIPS, type Clip } from './data'
import { useProject } from './projectStore'

const LABELS: Array<[keyof ShortmeClip['criteria'], string]> = [['hook', 'Hook-Stärke'], ['payoff', 'Emotionaler Payoff'], ['quotable', 'Zitierbarkeit'], ['standalone', 'Eigenständigkeit'], ['density', 'Emotion / Spannung']]
const TAG_LABEL: Record<string, string> = { hook: 'Hook', entity: 'Name/Zahl', emphasis: 'Betont' }

/** Echte Clips (M4) → Kartenmodell der Oberfläche. */
const VERIFY: Record<string, string> = { verified: 'geprüft', 'needs-review': 'bitte ansehen', failed: 'nicht bestanden' }

export function toUiClip(c: ShortmeClip, thumb: string | null): Clip {
  const cut = (c.autoCuts ?? []).reduce((n, x) => n + (x.end - x.start), 0)
  const v2 = c.v2
  return {
    id: c.id, title: c.title, hook: c.hookText, score: c.score, duration: Math.round(c.end - c.start - cut), faceRatio: c.stream ? 1 : (c.faceRatio ?? 1), thumb: thumb ?? '',
    tags: [...new Set(c.tags.map((t) => TAG_LABEL[t.kind]))].slice(0, 3),
    pending: c.pending,
    // Engine 6: redaktioneller Rang statt Punktzahl (Rangwert, keine Qualitäts- oder Viralitätswahrscheinlichkeit)
    ...(c.v6 ? { rank: c.v6.editorialRank } : {}),
    ...(isV4Pipeline(c.engine ?? '') && c.runId ? { v4RunId: c.runId, v4Label: c.engine === 'engine-mac' ? 'Engine Mac' : 'Engine 4' } : {}),
    reason: c.reason, criteria: v2 ? [] : LABELS.map(([k, label]) => ({ label, value: c.criteria[k] })),
    ...(v2 ? { notes: [...(c.v6 ? [`Rang ${c.v6.editorialRank}: ${c.v6.rankReason}`, `Prüfung der exportierten Datei: ${c.v6.audit.coverage.packets} Pakete, ${Math.round(c.v6.audit.coverage.observedSec)} von ${Math.round(c.v6.audit.coverage.outputSec)} s angesehen und angehört · Technik ${c.v6.audit.technical === 'pass' ? 'in Ordnung' : 'fehlerhaft'}`] : []), v2.eventNote, `Schnitt: ${VERIFY[v2.verification] ?? v2.verification}${cut > 0 ? ` · ${Math.round(cut)} s automatisch gekürzt` : ''}`, `Belege: ${v2.modalities.join(', ') || 'keine'}`, ...v2.uncertainty.slice(0, 3)] } : {})
  }
}

export function mapClips(file: ShortmeClips | null): Clip[] | null {
  return file ? file.clips.map((c) => toUiClip(c, file.thumbs[c.id])) : null
}

/** Reale Clips, sonst Beispieldaten (Browser-Vorschau/Demo). */
export function useClipList(): Clip[] {
  const real = useProject((s) => s.clipsFile)
  return mapClips(real) ?? CLIPS
}

export const allClips = (): Clip[] => mapClips(useProject.getState().clipsFile) ?? CLIPS
