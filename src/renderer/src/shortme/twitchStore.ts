import { create } from 'zustand'
import type { LiveSave, LiveStatus, TwitchStatus } from '@shared/twitch'

const api = (): Window['cutawan']['shortme']['twitch'] | null => (typeof window !== 'undefined' && window.cutawan?.shortme?.twitch ? window.cutawan.shortme.twitch : null)

const IDLE: LiveStatus = { running: false, channel: null, startedAt: null, runtimeSec: 0, bufferSec: 0, bufferMinutes: 15, bytes: 0, message: null, chat: false, adsSkipped: 0 }

interface TwitchState {
  live: LiveStatus
  saves: LiveSave[]
  status: TwitchStatus | null
  /** Kanalname, der aus dem Import-Feld in den Live-Tab übernommen wurde. */
  channelDraft: string
  setChannelDraft: (c: string) => void
  refreshLive: () => Promise<void>
  refreshSaves: () => Promise<void>
  refreshStatus: () => Promise<void>
  start: (channel: string) => Promise<string | null>
  /** Stoppt den Puffer; `save` (Standard) sichert alles Aufgenommene als Projekt. Ergebnis: Fehlertext oder null, `saved` = gesichert. */
  stop: (save?: boolean) => Promise<{ error: string | null; saved: boolean }>
  save: (minutes: number) => Promise<string | null>
}

const errText = (e: unknown): string => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e))

export const useTwitch = create<TwitchState>((set, get) => ({
  live: IDLE,
  saves: [],
  status: null,
  channelDraft: '',
  setChannelDraft: (channelDraft) => set({ channelDraft }),
  refreshLive: async () => { const a = api(); if (a) set({ live: await a.liveStatus().catch(() => get().live) }) },
  refreshSaves: async () => { const a = api(); if (a) set({ saves: await a.liveSaves().catch(() => []) }) },
  refreshStatus: async () => { const a = api(); if (a) set({ status: await a.status().catch(() => null) }) },
  start: async (channel) => {
    const a = api()
    if (!a) return 'Nur in der Desktop-App verfügbar.'
    try { set({ live: await a.liveStart(channel) }); return null } catch (e) { return errText(e) }
  },
  stop: async (save = true) => {
    const a = api()
    if (!a) return { error: 'Nur in der Desktop-App verfügbar.', saved: false }
    try { const s = await a.liveStop(save); set({ live: s }); if (s.saved) void get().refreshSaves(); return { error: null, saved: !!s.saved } } catch (e) { return { error: errText(e), saved: false } }
  },
  save: async (minutes) => {
    const a = api()
    if (!a) return 'Nur in der Desktop-App verfügbar.'
    try { await a.liveSave(minutes); void get().refreshSaves(); return null } catch (e) { return errText(e) }
  }
}))

export { errText as twitchErrText }
