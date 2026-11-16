// Audio+Video-Prüfung mit MiniCPM-o 4.5: das Modell bekommt den tatsächlichen Ausschnitt (Bilder UND Ton), nicht Transkript oder Einzelbilder.
// Antwort nur als Wahrheitswerte + kurze Sätze (freie Textfelder schweifen bei Modellen aus, siehe docs/ENGINE_V2_STATUS.md); alles wird gegen das Schema geprüft.
import { execFile } from 'node:child_process'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { FFMPEG_PATH } from '../../../../pipeline/ffmpeg'
import { projectDir } from '../../../project'
import type { Evidence } from '../../../../../shared/engineV2'
import type { AvSession } from './avWorker'
import { V3_AV_MODEL, V3_AV_PROMPT_REVISION } from './revisions'

export interface AvTarget { id: string; start: number; end: number; anchor: number; summary: string }
export interface AvAnswer { visible: string; audible: string; laughter: boolean; music: boolean; performance: boolean; reaction: boolean; payoff: boolean; needsSetup: boolean; unsure: boolean }

/** Prüffenster: um den Anker, höchstens 30 s (Modell- und Zeitbudget), innerhalb des Ereignisses, mindestens 8 s. */
export function avWindow(t: Pick<AvTarget, 'start' | 'end' | 'anchor'>, dur: number): { start: number; end: number } {
  const a = Math.max(0, t.start, t.anchor - 14)
  const b = Math.min(dur, Math.max(Math.min(t.end, a + 30), a + 8))
  return { start: Math.round(a * 10) / 10, end: Math.round(b * 10) / 10 }
}

export const avPrompt = (summary: string, seconds: number): string =>
  `Du siehst UND hörst einen ${seconds}-sekündigen Ausschnitt aus einem längeren Video. Hinweis zum Moment (kann falsch sein): ${summary || 'auffälliger Moment'}.\n` +
  'Beantworte nur nach dem, was du im Bild siehst und im Ton hörst. Antworte ausschließlich als JSON-Objekt mit genau diesen Feldern:\n' +
  '{"visible":"ein kurzer Satz: was ist zu sehen","audible":"ein kurzer Satz: was ist zu hören","laughter":true/false,"music":true/false,"performance":true/false (Rap, Gesang, Imitation, Vorführung),"reaction":true/false (starke sichtbare oder hörbare Reaktion),"payoff":true/false (ein klarer Höhepunkt oder eine Pointe),"needs_setup":true/false (ohne Vorgeschichte schwer verständlich),"unsure":true/false}'

const str = (x: unknown): string => (typeof x === 'string' ? x.replace(/\s+/g, ' ').trim().slice(0, 220) : '')
const bool = (o: Record<string, unknown>, k: string): boolean => { if (typeof o[k] !== 'boolean') throw new Error(`Feld ${k} fehlt oder ist kein Wahrheitswert`); return o[k] as boolean }

/** Modelltext → geprüfte Antwort. Nimmt das erste vollständige JSON-Objekt; alles Fehlende/Falsche ist ein Fehler (kein stilles Ergänzen). */
export function parseAvAnswer(text: string): AvAnswer {
  const i = text.indexOf('{'), j = text.lastIndexOf('}')
  if (i < 0 || j <= i) throw new Error('keine JSON-Antwort')
  const o = JSON.parse(text.slice(i, j + 1)) as Record<string, unknown>
  if (typeof o !== 'object' || o === null || Array.isArray(o)) throw new Error('Antwort ist kein Objekt')
  return { visible: str(o.visible), audible: str(o.audible), laughter: bool(o, 'laughter'), music: bool(o, 'music'), performance: bool(o, 'performance'), reaction: bool(o, 'reaction'), payoff: bool(o, 'payoff'), needsSetup: bool(o, 'needs_setup'), unsure: bool(o, 'unsure') }
}

/** Ausschnitt mit Bild und Ton (klein, damit der Worker nur wenig dekodieren muss). */
const cutAv = (video: string, start: number, dur: number, out: string, signal?: AbortSignal): Promise<void> => new Promise((resolve, reject) => {
  execFile(FFMPEG_PATH, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', start.toFixed(2), '-t', dur.toFixed(2), '-i', video, '-vf', 'scale=-2:448', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28', '-c:a', 'aac', '-ar', '16000', '-ac', '1', out], { windowsHide: true, signal }, (err) => (err ? reject(err) : resolve()))
})

export interface AvResult { evidence: Evidence[]; checked: Map<string, string[]>; failed: Array<{ id: string; reason: string }>; seconds: number; peakVramBytes?: number; calls: number }

export async function verifyAv(s: AvSession, o: { hash: string; video: string; durationSec: number; targets: AvTarget[]; signal?: AbortSignal; onProgress?: (f: number, msg: string) => void }): Promise<AvResult> {
  const t0 = Date.now()
  const tmp = join(projectDir(o.hash), 'analysis', 'shared', 'av-tmp')
  await mkdir(tmp, { recursive: true })
  const evidence: Evidence[] = [], checked = new Map<string, string[]>(), failed: Array<{ id: string; reason: string }> = []
  let peak: number | undefined, calls = 0
  try {
    for (let i = 0; i < o.targets.length; i++) {
      o.signal?.throwIfAborted()
      const t = o.targets[i]
      o.onProgress?.(i / Math.max(1, o.targets.length), `Bild und Ton prüfen (${i + 1}/${o.targets.length}) …`)
      const w = avWindow(t, o.durationSec)
      const file = join(tmp, `${t.id}.mp4`)
      try {
        await cutAv(o.video, w.start, w.end - w.start, file, o.signal)
        calls++
        const r = await s.worker.request<{ text: string; vramPeakBytes?: number }>('analyze_av', { path: file, prompt: avPrompt(t.summary, Math.round(w.end - w.start)), maxNewTokens: 260 }, { runId: s.runId, timeoutMs: Number(process.env.AV_TIMEOUT ?? 240_000), signal: o.signal })
        peak = r.vramPeakBytes ?? peak
        const a = parseAvAnswer(r.text)
        const base = { start: w.start, end: w.end, modelRev: `${V3_AV_MODEL.id}@${V3_AV_MODEL.revision.slice(0, 8)}/${V3_AV_PROMPT_REVISION}`, state: 'observed' as const, source: V3_AV_MODEL.id, ...(a.unsure ? { uncertainty: 'Modell unsicher' } : {}) }
        const flags = (xs: Array<[boolean, string]>): string => xs.filter(([b]) => b).map(([, l]) => l).join(', ')
        const vId = `av-v-${t.id}`, aId = `av-a-${t.id}`
        evidence.push({ ...base, id: vId, modality: 'visual', observation: [a.visible, flags([[a.reaction, 'starke Reaktion'], [a.payoff, 'klarer Höhepunkt'], [a.needsSetup, 'braucht Vorgeschichte']])].filter(Boolean).join(' · ') })
        evidence.push({ ...base, id: aId, modality: 'audio', observation: [a.audible, flags([[a.laughter, 'Lachen'], [a.music, 'Musik/Gesang'], [a.performance, 'Darbietung']])].filter(Boolean).join(' · ') })
        checked.set(t.id, [vId, aId])
      } catch (e) {
        if (o.signal?.aborted) throw e
        failed.push({ id: t.id, reason: e instanceof Error ? e.message.slice(0, 160) : String(e) })
      } finally { await rm(file, { force: true }).catch(() => undefined) }
    }
  } finally { await rm(tmp, { recursive: true, force: true }).catch(() => undefined) }
  return { evidence, checked, failed, seconds: (Date.now() - t0) / 1000, peakVramBytes: peak, calls }
}
