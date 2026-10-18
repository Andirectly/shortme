// Twitch-Chat als Ranking-Signal (standardmäßig AUS: ohne den Schalter in den Einstellungen wird nie Chat geladen oder mitgeschrieben).
// Der Chat wird nie im Video angezeigt oder eingebrannt – er fließt nur als Zahl ins Ranking und als Marke ins Transkript.
import { readFile, rm } from 'node:fs/promises'
import { writeFileAtomic } from '../shortme/atomic'
import { projectFile } from '../shortme/project'
import type { HeatPoint } from '../shortme/clips/heat'
import type { AudioEvent } from '../shortme/clips/audioEvents'
import { ensureTool, runTool } from './tools'

/** Chat reagiert mit Verzögerung: Nachrichten bei t gehören zu einem Ereignis bei t − 15 s. */
export const CHAT_LAG_SEC = 15

const LAUGH = /(?:^|[\s,.!?])(LUL+W?|KEKW?L?|OMEGALUL|ICANT|LMAO+|LOL+|XD+|AHAH\w*|HAHA\w*|PEPEL(?:AUGH)?|4Head|KEK|😂|🤣)(?=$|[\s,.!?])/i

export interface ChatMsg { t: number; text: string }

/** Format von TwitchDownloaderCLI (JSON); eigener IRC-Mitschnitt schreibt dasselbe Minimalformat. */
export function parseChatJson(json: unknown, offsetSec = 0): ChatMsg[] {
  const comments = (json as { comments?: Array<{ content_offset_seconds?: number; message?: { body?: string; fragments?: Array<{ text?: string }> } }> })?.comments ?? []
  const out: ChatMsg[] = []
  for (const c of comments) {
    const t = Number(c.content_offset_seconds)
    if (!Number.isFinite(t)) continue
    const text = c.message?.body ?? (c.message?.fragments ?? []).map((f) => f.text ?? '').join('')
    out.push({ t: t - offsetSec, text })
  }
  return out
}

export const isLaugh = (text: string): boolean => LAUGH.test(text)

export interface ChatSignal { heat: HeatPoint[]; laughs: AudioEvent[]; messages: number }

/** Nachrichten pro Sekunde (3-s-Glättung), um 15 s nach vorne verschoben, pro Video normalisiert (98. Perzentil = 1); Lach-Salven als Ereignisse. */
export function chatSignal(msgs: ChatMsg[], durationSec: number): ChatSignal {
  const n = Math.max(1, Math.ceil(durationSec))
  const rate = new Float64Array(n + CHAT_LAG_SEC + 8)
  const laugh = new Float64Array(n + CHAT_LAG_SEC + 8)
  for (const m of msgs) {
    const i = Math.floor(m.t)
    if (i < 0 || i >= rate.length) continue
    rate[i]++
    if (isLaugh(m.text)) laugh[i]++
  }
  const smooth = (a: Float64Array, half: number): Float64Array => {
    const o = new Float64Array(a.length)
    for (let i = 0; i < a.length; i++) { let s = 0, c = 0; for (let k = i - half; k <= i + half; k++) if (k >= 0 && k < a.length) { s += a[k]; c++ } o[i] = s / c }
    return o
  }
  const r = smooth(rate, 1)
  const sorted = [...r.slice(0, n)].sort((a, b) => a - b)
  const p98 = sorted[Math.min(n - 1, Math.floor(n * 0.98))] || sorted[n - 1] || 1
  const heat: HeatPoint[] = []
  for (let e = 0; e < n; e++) heat.push({ start: e, end: e + 1, value: Math.min(1, (r[e + CHAT_LAG_SEC] ?? 0) / (p98 || 1)) })
  // Lach-Salven: ≥ 5 Lach-Nachrichten in 8 s und ≥ 20 % aller Nachrichten dort
  const l8 = new Float64Array(laugh.length)
  const a8 = new Float64Array(laugh.length)
  for (let i = 0; i < laugh.length; i++) for (let k = 0; k < 8 && i + k < laugh.length; k++) { l8[i] += laugh[i + k]; a8[i] += rate[i + k] }
  const laughs: AudioEvent[] = []
  for (let i = 0; i < n + CHAT_LAG_SEC; i++) {
    if (l8[i] >= 5 && l8[i] >= 0.2 * a8[i] && l8[i] >= (l8[i - 1] ?? 0) && l8[i] > (l8[i + 1] ?? 0)) {
      const start = i - CHAT_LAG_SEC
      if (start >= 0 && start < n && !laughs.some((x) => Math.abs(x.start - start) < 10)) laughs.push({ kind: 'chat', start, end: start + 5, score: Math.min(1, l8[i] / 15) })
    }
  }
  return { heat, laughs, messages: msgs.length }
}

const signalFile = (hash: string): string => projectFile(hash, 'chatsignal.json')
export const chatFile = (hash: string): string => projectFile(hash, 'chat.json')

export async function saveChatSignal(hash: string, s: ChatSignal): Promise<void> { await writeFileAtomic(signalFile(hash), JSON.stringify(s)) }
export async function loadChatSignal(hash: string): Promise<ChatSignal | null> {
  try { const s = JSON.parse(await readFile(signalFile(hash), 'utf8')) as ChatSignal; return Array.isArray(s.heat) ? s : null } catch { return null }
}

/** Chat zum Projekt: Signal aus Nachrichten berechnen und ablegen (Rohchat bleibt als chat.json im Projekt). */
export async function storeChat(hash: string, msgs: ChatMsg[], durationSec: number): Promise<boolean> {
  if (!msgs.length) return false
  await saveChatSignal(hash, chatSignal(msgs, durationSec))
  return true
}

/** VOD/Clip-Chat mit TwitchDownloaderCLI laden (nur aufrufen, wenn der Chat-Schalter an ist). */
export async function downloadChatForProject(hash: string, idOrSlug: string, section: [number, number] | undefined, durationSec: number): Promise<boolean> {
  const bin = await ensureTool('twitchdownloader')
  const out = chatFile(hash)
  const args = ['chatdownload', '--id', idOrSlug, '-o', out, '--collision', 'Overwrite']
  if (section) args.push('-b', String(section[0]), '-e', String(section[1]))
  await runTool(bin, args, { timeoutMs: 20 * 60_000 })
  let ok: boolean
  try {
    const json = JSON.parse(await readFile(out, 'utf8'))
    ok = await storeChat(hash, parseChatJson(json, section?.[0] ?? 0), durationSec)
  } catch { ok = false }
  if (!ok) await rm(out, { force: true })
  return ok
}
