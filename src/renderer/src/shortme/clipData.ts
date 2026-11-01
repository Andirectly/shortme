import type { ShortmeClip, ShortmeClips } from '@shared/shortme'
import { CLIPS, type Clip } from './data'
import { useProject } from './projectStore'

const LABELS: Array<[keyof ShortmeClip['criteria'], string]> = [['hook', 'Hook-Stärke'], ['payoff', 'Emotionaler Payoff'], ['quotable', 'Zitierbarkeit'], ['standalone', 'Eigenständigkeit'], ['density', 'Emotion / Spannung']]
const TAG_LABEL: Record<string, string> = { hook: 'Hook', entity: 'Name/Zahl', emphasis: 'Betont' }

/** Echte Clips (M4) → Kartenmodell der Oberfläche. */
export function toUiClip(c: ShortmeClip, thumb: string | null): Clip {
  return {
    id: c.id, title: c.title, hook: c.hookText, score: c.score, duration: Math.round(c.end - c.start), faceRatio: c.stream ? 1 : (c.faceRatio ?? 1), thumb: thumb ?? '',
    tags: [...new Set(c.tags.map((t) => TAG_LABEL[t.kind]))].slice(0, 3),
    pending: c.pending,
    reason: c.reason, criteria: LABELS.map(([k, label]) => ({ label, value: c.criteria[k] }))
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
