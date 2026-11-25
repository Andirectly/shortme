// Engine 6 – Detail-Zoom (Kap. 20): bleibt nach der Low-Res-Beobachtung eine konkrete Detailfrage offen, nennt das AV-Modell EINE Region (normiert im
// orientierten Bild), der Host prüft sie (Grenzen, Mindest-/Höchstgröße), schneidet sie mit Rand aus dem ORIGINAL bei der echten Quellzeit aus und stellt
// die Frage mit Gesamtbild + Ausschnitt. Keine erfundenen Boxen (ungültig → keine Detailprüfung), keine Hochskalierung des Proxys, kein Exportlayout.
import { execFile } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { FFMPEG_PATH } from '../../../../pipeline/ffmpeg'
import { isObj } from '../../llm'
import { parseModelJson } from '../v4/core'
import { cutAv } from '../v4/media'
import type { AvSession } from '../v3/avWorker'

export interface Box { x: number; y: number; w: number; h: number }
export interface RoiResult { asked: boolean; box: Box | null; second: number | null; cropPath: string | null; answer: string; visible: boolean | null; reason: string; calls: number }

export const isDetailQuestion = (q: string | undefined): boolean => !!q && /(schrift|text|hud|anzeige|etikett|logo|marke|objekt|gegenstand|gesicht|ausdruck|miene|zahl|punkte|score|bildschirm|display|tafel|schild|preis|detail)/i.test(q)

/** Hostprüfung der Modellbox: innerhalb 0..1, 5–60 % Fläche; dann mit 15 % Rand erweitert und in das Bild geklemmt. */
export function validateBox(x: unknown): Box | null {
  if (!isObj(x)) return null
  const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : NaN)
  const b = { x: n(x.x), y: n(x.y), w: n(x.w), h: n(x.h) }
  if (Object.values(b).some((v) => !Number.isFinite(v)) || b.x < 0 || b.y < 0 || b.w <= 0 || b.h <= 0 || b.x + b.w > 1.001 || b.y + b.h > 1.001) return null
  if (b.w * b.h < 0.005 || b.w * b.h > 0.6) return null
  const mx = b.w * 0.15, my = b.h * 0.15
  const x0 = Math.max(0, b.x - mx), y0 = Math.max(0, b.y - my), x1 = Math.min(1, b.x + b.w + mx), y1 = Math.min(1, b.y + b.h + my)
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/** Ausschnitt aus dem Original bei Quellzeit t (FFmpeg dreht nach Metadaten, SAR wird auf quadratische Pixel gebracht → Box gilt im orientierten Bild). */
export function cropOriginal(video: string, t: number, box: Box, out: string, signal?: AbortSignal): Promise<void> {
  const f = (v: number): string => v.toFixed(4)
  const vf = `scale=iw*sar:ih,setsar=1,crop=trunc(iw*${f(box.w)}/2)*2:trunc(ih*${f(box.h)}/2)*2:trunc(iw*${f(box.x)}):trunc(ih*${f(box.y)})`
  return new Promise((resolve, reject) => execFile(FFMPEG_PATH, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', Math.max(0, t).toFixed(3), '-i', video, '-frames:v', '1', '-vf', vf, out], { windowsHide: true, signal }, (e) => (e ? reject(e) : resolve())))
}

export async function detailZoom(s: AvSession, o: { video: string; span: { start: number; end: number }; question: string; hasAudio: boolean; tmpDir: string; signal?: AbortSignal }): Promise<RoiResult> {
  await mkdir(o.tmpDir, { recursive: true })
  const win = { start: o.span.start, end: Math.min(o.span.end, o.span.start + 20) }
  const file = join(o.tmpDir, `roi-${Math.round(win.start * 10)}.mp4`)
  await cutAv(o.video, win.start, win.end - win.start, file, o.hasAudio, o.signal)
  const ask1 = [
    `Frage: ${o.question}`,
    'Finde die EINE Bildregion, in der das Detail zur Beantwortung zu sehen ist (z. B. Schrift, Anzeige, Objekt, Gesicht).',
    'Gib die Sekunde (ab Ausschnittbeginn) und die Region als Anteile des Bildes an (x, y = linke obere Ecke, w, h; alle 0..1). Gibt es keine solche Region: box null.',
    'Antworte NUR als JSON: {"second": 3, "box": {"x": 0.1, "y": 0.6, "w": 0.3, "h": 0.2}}'
  ].join('\n')
  const r1 = await s.worker.request<{ text: string }>('analyze_av', { path: file, prompt: ask1, maxNewTokens: 80, temperature: 0 }, { runId: s.runId, timeoutMs: 180_000, signal: o.signal })
  let box: Box | null = null, second: number | null = null
  try { const j = parseModelJson(r1.text) as Record<string, unknown>; box = validateBox(j.box); const sec = Number(j.second); second = Number.isFinite(sec) && sec >= 0 && sec <= win.end - win.start ? sec : null } catch { box = null }
  if (!box || second === null) return { asked: true, box: null, second: null, cropPath: null, answer: '', visible: null, reason: 'keine gültige Region genannt – Detail bleibt unknown', calls: 1 }
  const crop = join(o.tmpDir, `roi-${Math.round(win.start * 10)}-${Math.round(second * 10)}.png`)
  await cropOriginal(o.video, win.start + second, box, crop, o.signal)
  const ask2 = [`Frage: ${o.question}`, 'Zusätzlich zum Ausschnitt bekommst du einen hochaufgelösten Bildausschnitt aus dem Original (Quellbild, nicht vergrößert).', 'Beantworte die Frage nur mit dem, was zu sehen ist. visible=false, wenn das Detail nicht erkennbar ist.', 'Antworte NUR als JSON: {"visible": true, "answer": "höchstens 15 Wörter"}'].join('\n')
  const r2 = await s.worker.request<{ text: string }>('analyze_av', { path: file, prompt: ask2, maxNewTokens: 80, temperature: 0, extraImages: [{ path: crop, label: `Originalausschnitt bei Sekunde ${second.toFixed(1)}` }] }, { runId: s.runId, timeoutMs: 180_000, signal: o.signal })
  try {
    const j = parseModelJson(r2.text) as Record<string, unknown>
    return { asked: true, box, second: win.start + second, cropPath: crop, answer: typeof j.answer === 'string' ? j.answer.slice(0, 160) : '', visible: j.visible === true ? true : j.visible === false ? false : null, reason: 'Detail aus Originalausschnitt', calls: 2 }
  } catch { return { asked: true, box, second: win.start + second, cropPath: crop, answer: '', visible: null, reason: 'Detailantwort ungültig', calls: 2 } }
}
