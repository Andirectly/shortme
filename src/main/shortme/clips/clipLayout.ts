// Bildausschnitt je Clip (aus analysis.ts herausgelöst, Verhalten unverändert): Gesichter/Spuren/Sprecher, Facecam-Szenen bei Streams, „Ganzes Bild“, Sicherheitsnetz.
// Engine 1–4/Mac rufen es nach der Auswahl auf; Engine 6 ruft es VOR dem Render auf und friert den Ausschnitt im Plan ein (keine zweite Planung nach der Prüfung).
import type { ShortmeClip } from '@shared/shortme'
import type { ProjectMeta } from '../project'
import { layoutForClip } from '../layout/run'
import { snapShotsToCuts } from '../../../shared/shots'
import { channelLayout } from '../profiles'
import { findFacecam } from '../layout/facecam'
import { classifyScenes } from '../layout/streamScenes'
import { mergeStreamScenes, scenesOf } from '../layout/streamShots'
import { defaultStream, type StreamLayout } from '../../../shared/streamLayout'
import type { FrameChoice } from '../../../shared/videoKind'
import { guardEmptyShots, type PlanOptions } from '../../../shared/layoutPlan'

export interface LayoutContext {
  meta: ProjectMeta
  cuts: number[]
  frame: FrameChoice
  plan: Partial<PlanOptions>
  streamBase: StreamLayout | null
  /** weitere Facecams (andere Streamer-Ansichten), über alle Clips des Laufs geteilt */
  otherCams: StreamLayout[]
  signal?: AbortSignal
}

/** Planoptionen + Facecam-Suche (nur bei „stream“) – einmal je Lauf. */
export async function prepareLayout(meta: ProjectMeta, cuts: number[], frame: FrameChoice, tracking: { split: boolean; follow: PlanOptions['follow'] }, signal?: AbortSignal, report?: (m: string) => void): Promise<LayoutContext> {
  const plan: Partial<PlanOptions> = { allowSplit: tracking.split && frame !== 'fixed', follow: frame === 'fixed' ? 'fixed' : tracking.follow }
  let streamBase: StreamLayout | null = null
  if (frame === 'stream') {
    report?.('Facecam suchen …')
    const dims = { width: meta.width, height: meta.height }
    streamBase = await channelLayout(meta.twitch?.channel)
    if (!streamBase) { const found = await findFacecam(meta.sourcePath, 0, meta.durationSec, 14, signal).catch(() => null); if (found) streamBase = defaultStream(dims, found.cam) }
    report?.(streamBase ? 'Facecam gefunden' : 'Keine Facecam gefunden – Gameplay-Ausschnitt')
  }
  return { meta, cuts, frame, plan, streamBase, otherCams: [], signal }
}

/** Ausschnitt für einen Clip. `penalty` = bisherige Gesichtsquoten-Strafe (Engine 6 ignoriert sie: wortlose/Gameplay-Clips werden nicht bestraft). */
export async function layoutClip(ctx: LayoutContext, clip: ShortmeClip): Promise<{ clip: ShortmeClip; layout: Awaited<ReturnType<typeof layoutForClip>>; penalty: number }> {
  const { meta, cuts, frame, signal } = ctx
  const l = await layoutForClip(meta, clip, cuts, signal, undefined, ctx.plan)
  let shots = snapShotsToCuts(guardEmptyShots(l.shots, l.input), clip.start, cuts) // Sicherheitsnetz: keine Person im Ausschnitt → Ganzes Bild; Wechsel exakt auf den Videoschnitt
  let penalty = l.penalty
  let stream: StreamLayout | undefined
  if (frame === 'fit') shots = [{ start: 0, end: clip.end - clip.start, layout: 'fit', cx: 0.5, zoom: 1 }]
  else if (frame === 'stream') {
    penalty = 0 // Gesichtsquote sagt bei Streams nichts: das Gameplay ist der Inhalt
    if (ctx.streamBase) {
      const base = ctx.streamBase
      const scenes = await classifyScenes(meta.sourcePath, scenesOf(clip.start, clip.end, cuts), base, { width: meta.width, height: meta.height }, ctx.otherCams, signal)
      shots = mergeStreamScenes(clip.start, clip.end, shots, scenes, base)
      stream = base
    } else shots = [{ start: 0, end: clip.end - clip.start, layout: 'fixed', cx: 0.5, zoom: 1 }]
  }
  return { clip: { ...clip, shots, faceRatio: l.faceRatio, ...(stream ? { stream } : {}) }, layout: l, penalty }
}
