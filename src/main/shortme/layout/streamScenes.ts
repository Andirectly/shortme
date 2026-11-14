// Pro Szene die passende Facecam bestimmen: erst die bekannte (Kanal-)Facecam, sonst eine andere im Bild (z. B. wenn der Stream auf die Ansicht eines
// anderen Streamers wechselt, dessen Kamera an anderer Stelle sitzt) – sie wird dann genauso eingebunden wie die erste.
import { camHasFace, findFacecam } from './facecam'
import { sameCam, type Scene } from './streamShots'
import { defaultStream, type StreamLayout } from '../../../shared/streamLayout'

export type SceneCam = Scene & { cam: boolean; stream?: StreamLayout }

/**
 * `known` sammelt gefundene weitere Facecams über alle Clips hinweg (gleiche Kamera → gleiches Layout, kein Flackern).
 * Eine fremde Kamera muss in mindestens der Hälfte der Stichproben an derselben Stelle ein Gesicht zeigen (`findFacecam`).
 */
export async function classifyScenes(path: string, scenes: Scene[], base: StreamLayout, dims: { width: number; height: number }, known: StreamLayout[], signal?: AbortSignal): Promise<SceneCam[]> {
  const out: SceneCam[] = []
  for (const sc of scenes) {
    const mid = (sc.start + sc.end) / 2
    if (await camHasFace(path, mid, base.cam, signal).catch(() => false)) { out.push({ ...sc, cam: true }); continue }
    // bekannte weitere Kameras zuerst prüfen (schnell), dann neu suchen
    const hit = await (async (): Promise<StreamLayout | null> => {
      for (const k of known) if (await camHasFace(path, mid, k.cam, signal).catch(() => false)) return k
      if (sc.end - sc.start < 2) return null
      const found = await findFacecam(path, sc.start, sc.end, Math.min(8, Math.max(4, Math.round((sc.end - sc.start) / 1.5))), signal).catch(() => null)
      if (!found || found.share < 0.5) return null
      // dieselbe Kamera wie die Kanal-Facecam, nur gerade nicht erkannt → keine „neue“
      if (sameCam(found.cam, base.cam)) return base
      // Gesicht sitzt im Rahmen der Kanal-Facecam (nur anders zugeschnitten gefunden) → dieselbe Kamera
      const fx = found.face.x + found.face.w / 2, fy = found.face.y + found.face.h / 2
      if (fx >= base.cam.x && fx <= base.cam.x + base.cam.w && fy >= base.cam.y && fy <= base.cam.y + base.cam.h) return base
      const layout = defaultStream(dims, found.cam, base.preset, base.gap)
      const dup = known.find((k) => sameCam(k.cam, layout.cam))
      if (dup) return dup
      known.push(layout)
      return layout
    })()
    out.push(hit === base ? { ...sc, cam: true } : hit ? { ...sc, cam: true, stream: hit } : { ...sc, cam: false })
  }
  return out
}
