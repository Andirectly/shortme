// Facecam finden: aktive Gesichtserkennung auf Stichproben-Bildern → Gesicht, das an derselben kleinen Stelle sitzt → Rahmen an den Kanten
// des Kamera-Overlays (shared/camEdges.ts). Pro Szene wird geprüft, ob die Facecam im Bild ist (z. B. nicht bei Vollbild-Kamera).
import { spawn } from 'node:child_process'
import { FFMPEG_PATH } from '../../pipeline/ffmpeg'
import { detectFacesYuNet } from '../../pipeline/yunet'
import { pickStableFace, refineCam, type FaceN } from '../../../shared/camEdges'
import type { NRect } from '../../../shared/streamLayout'

export interface Frame { rgb: Buffer; w: number; h: number }
export interface FacecamFind { cam: NRect; face: NRect; share: number; edges: number }

const SAMPLE_W = 960

/** Ein Einzelbild als RGB (verkleinert auf ~960 px Breite). */
export function grabFrame(path: string, t: number, signal?: AbortSignal): Promise<Frame> {
  return new Promise((resolve, reject) => {
    const p = spawn(FFMPEG_PATH, ['-hide_banner', '-loglevel', 'error', '-ss', t.toFixed(2), '-i', path, '-frames:v', '1', '-vf', `scale=${SAMPLE_W}:-2`, '-f', 'image2pipe', '-vcodec', 'ppm', 'pipe:1'], { windowsHide: true, signal })
    const chunks: Buffer[] = []
    p.stdout.on('data', (d: Buffer) => chunks.push(d))
    p.on('error', reject)
    p.on('close', () => {
      const buf = Buffer.concat(chunks)
      // PPM: "P6\nW H\n255\n" + Daten
      const m = buf.subarray(0, 32).toString('latin1').match(/^P6\s+(\d+)\s+(\d+)\s+255\s/)
      if (!m) { reject(new Error('Bild konnte nicht gelesen werden')); return }
      const w = Number(m[1]), h = Number(m[2])
      resolve({ rgb: buf.subarray(m[0].length, m[0].length + w * h * 3), w, h })
    })
  })
}

export function toGray(f: Frame): Uint8Array {
  const g = new Uint8Array(f.w * f.h)
  for (let i = 0, j = 0; i < g.length; i++, j += 3) g[i] = (f.rgb[j] * 77 + f.rgb[j + 1] * 150 + f.rgb[j + 2] * 29) >> 8
  return g
}

function cropRgb(f: Frame, r: NRect): Frame {
  const x0 = Math.max(0, Math.round(r.x * f.w)), y0 = Math.max(0, Math.round(r.y * f.h))
  const w = Math.max(16, Math.min(f.w - x0, Math.round(r.w * f.w))), h = Math.max(16, Math.min(f.h - y0, Math.round(r.h * f.h)))
  const out = Buffer.alloc(w * h * 3)
  for (let y = 0; y < h; y++) f.rgb.copy(out, y * w * 3, ((y0 + y) * f.w + x0) * 3, ((y0 + y) * f.w + x0 + w) * 3)
  return { rgb: out, w, h }
}

const toN = (b: { x1: number; y1: number; x2: number; y2: number }): FaceN => ({ x1: b.x1, y1: b.y1, x2: b.x2, y2: b.y2 })

/**
 * Facecam in [start, end] suchen. Mindestens die Hälfte der Stichproben muss ein kleines Gesicht an gleicher Stelle zeigen;
 * Vollbild-Kamera-Szenen (großes Gesicht) werden dadurch nicht verwechselt.
 */
export async function findFacecam(path: string, start: number, end: number, samples = 14, signal?: AbortSignal): Promise<FacecamFind | null> {
  const frames: Frame[] = []
  const faces: FaceN[][] = []
  for (let i = 0; i < samples; i++) {
    const t = start + ((i + 0.5) / samples) * (end - start)
    try {
      const f = await grabFrame(path, t, signal)
      frames.push(f)
      faces.push((await detectFacesYuNet(f.rgb, f.w, f.h, signal)).filter((b) => b.score > 0.6).map(toN))
    } catch (e) { if (signal?.aborted) throw e }
  }
  const stable = pickStableFace(faces)
  if (!stable || frames.length < 4) return null
  const { w, h } = frames[0]
  const withFace = frames.filter((_, i) => faces[i].some((g) => g.x1 < stable.face.x2 && g.x2 > stable.face.x1 && g.y1 < stable.face.y2 && g.y2 > stable.face.y1))
  const res = refineCam((withFace.length >= 4 ? withFace : frames).map(toGray), w, h, stable.face)
  return { cam: res.cam, face: { x: stable.face.x1, y: stable.face.y1, w: stable.face.x2 - stable.face.x1, h: stable.face.y2 - stable.face.y1 }, share: stable.share, edges: res.edges }
}

/** Ist die Facecam zum Zeitpunkt t im Bild (Gesicht im Facecam-Rahmen)? */
export async function camHasFace(path: string, t: number, cam: NRect, signal?: AbortSignal): Promise<boolean> {
  const f = await grabFrame(path, t, signal)
  const c = cropRgb(f, cam)
  const faces = await detectFacesYuNet(c.rgb, c.w, c.h, signal)
  return faces.some((b) => b.score > 0.6 && (b.x2 - b.x1) * (b.y2 - b.y1) > 0.025)
}
