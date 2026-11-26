// „Nur Untertitel“: ein fertiges Short (oder anderes fertiges Video) wird importiert und transkribiert; es entsteht EIN Clip über das ganze Video, der nichts schneidet
// (keine Pausenschnitte, kein Cold Opener, kein Hook). Im Editor wählt man Stil und korrigiert Wörter; der Export brennt nur die Untertitel ein.
import type { ShortmeClip } from '@shared/shortme'
import { LEGACY_RUN_ID } from '../../../shared/engine'
import { markStage, type ProjectMeta } from '../project'
import { writeFileAtomic } from '../atomic'
import type { Transcript } from '../transcription'
import { makeThumbs } from './thumbs'
import { clipsPathFor, setSelected, showRun } from './engines/state'
import type { ClipsFile } from './analysis'

export const CAPTION_ONLY_CLIP_ID = 'caption-only'

/** Reine Funktion (getestet): der Clip über das ganze Video. 9:16-Quellen bleiben unbeschnitten („fixed“), andere werden ganz ins Bild gesetzt („fit“). */
export function buildCaptionOnlyClip(meta: Pick<ProjectMeta, 'title' | 'durationSec' | 'width' | 'height'>, wordCount: number): ShortmeClip {
  const dur = meta.durationSec
  const aspect = meta.width > 0 && meta.height > 0 ? meta.width / meta.height : 9 / 16
  const vertical = Math.abs(aspect - 9 / 16) <= 0.02
  const title = meta.title.replace(/\.[a-z0-9]{2,4}$/i, '').trim().slice(0, 80) || 'Video'
  return {
    id: CAPTION_ONLY_CLIP_ID, start: 0, end: dur, firstWord: 0, lastWord: wordCount - 1, score: 0,
    criteria: { hook: 3, payoff: 3, quotable: 3, standalone: 3, density: 3 }, title, hookText: '', reason: 'Fertiges Video – nur Untertitel', tags: [],
    source: 'texttiling', engine: 'legacy', snap: [], extended: 0,
    shots: [{ start: 0, end: dur, layout: vertical ? 'fixed' : 'fit', cx: 0.5, zoom: 1 }],
    captionOnly: true, ...(wordCount === 0 ? { wordless: true } : {})
  } as ShortmeClip
}

/** Clip anlegen und als angezeigtes Ergebnis veröffentlichen (wie das bisherige Ergebnis eines Projekts: clips.json). */
export async function publishCaptionOnly(meta: ProjectMeta, t: Transcript, signal?: AbortSignal): Promise<ShortmeClip> {
  const clip = buildCaptionOnlyClip(meta, t.words.length)
  await makeThumbs(meta, [clip], signal)
  const file: ClipsFile = { version: 1, hash: meta.hash, query: '', createdAt: new Date().toISOString(), mode: 'texttiling', engine: 'legacy', runId: LEGACY_RUN_ID, clips: [clip] }
  await writeFileAtomic(clipsPathFor(meta.hash, LEGACY_RUN_ID), JSON.stringify(file, null, 1))
  await markStage(meta.hash, 'clips', true)
  await setSelected(meta.hash, 'legacy')
  await showRun(meta.hash, LEGACY_RUN_ID)
  return clip
}
