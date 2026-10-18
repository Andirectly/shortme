import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { dataRoot } from '../engines/paths'
import { writeFileAtomic } from '../shortme/atomic'

export interface TwitchSettings {
  /** Chat als Ranking-Signal (Standard: aus – ohne den Schalter wird nie Chat geladen oder mitgeschrieben). */
  chatSignal: boolean
  /** Länge des Live-Ringpuffers in Minuten. */
  bufferMinutes: number
}

const DEFAULTS: TwitchSettings = { chatSignal: false, bufferMinutes: 15 }
const file = (): string => join(dataRoot(), 'twitch.json')

export async function loadTwitchSettings(): Promise<TwitchSettings> {
  try {
    const j = JSON.parse(await readFile(file(), 'utf8')) as Partial<TwitchSettings>
    return { chatSignal: j.chatSignal === true, bufferMinutes: Math.min(120, Math.max(3, Math.round(Number(j.bufferMinutes) || DEFAULTS.bufferMinutes))) }
  } catch { return { ...DEFAULTS } }
}

export async function saveTwitchSettings(patch: Partial<TwitchSettings>): Promise<TwitchSettings> {
  const next = { ...(await loadTwitchSettings()), ...patch }
  next.bufferMinutes = Math.min(120, Math.max(3, Math.round(next.bufferMinutes)))
  await writeFileAtomic(file(), JSON.stringify(next, null, 2))
  return next
}
