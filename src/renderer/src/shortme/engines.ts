import { create } from 'zustand'
import type { AssetSpec, AssetStatus, CheckItem, HardwareInfo } from '@shared/engines'
import { MODELS, SYSTEM_CHECK } from './data'

const api = (): Window['cutawan']['engines'] | null => (typeof window !== 'undefined' && window.cutawan?.engines ? window.cutawan.engines : null)

/** Ohne Electron (Browser-Vorschau): Beispieldaten, damit die UI trotzdem testbar bleibt. */
const MOCK_CATALOG: AssetSpec[] = MODELS.map((m) => ({ id: m.id, name: m.name, kind: m.kind === 'Transkription' ? 'transcription' : m.kind === 'Sprachmodell' ? 'llm' : 'vision', note: m.note, files: [{ url: '', name: m.id, size: 1e9, sha256: '' }], expect: [], recommendedFromVramMb: m.recommended ? 0 : undefined }))
const MOCK_HW: HardwareInfo = { gpuName: 'NVIDIA GeForce RTX 5090', vramTotalMb: 32607, vramFreeMb: 30000, driver: '610.88', freeDiskGb: 717, profile: 'standard', recommendedLlm: 'qwen', kvQuant: false }

interface EnginesState {
  catalog: AssetSpec[]
  status: Record<string, AssetStatus>
  hw: HardwareInfo | null
  check: CheckItem[]
  checking: boolean
  loaded: boolean
  installingAll: boolean
  wizardDismissed: boolean
  init: () => Promise<void>
  refreshCheck: () => Promise<void>
  install: (id: string) => Promise<void>
  pause: (id: string) => Promise<void>
  cancel: (id: string) => Promise<void>
  importFolder: () => Promise<{ imported: string[]; skipped: string[] } | null>
  installRecommended: () => Promise<void>
  dismissWizard: () => void
}

let unsub: (() => void) | null = null

export const useEngines = create<EnginesState>((set, get) => ({
  catalog: [],
  status: {},
  hw: null,
  check: [],
  checking: false,
  loaded: false,
  installingAll: false,
  wizardDismissed: false,
  init: async () => {
    const e = api()
    if (!e) {
      const status = Object.fromEntries(MODELS.map((m) => [m.id, { id: m.id, state: m.state === 'installed' ? 'installed' : m.state === 'downloading' ? 'downloading' : 'missing', progress: m.state === 'installed' ? 1 : m.state === 'downloading' ? 0.62 : 0, bytesDone: 0, bytesTotal: 1e9 } as AssetStatus]))
      set({ catalog: MOCK_CATALOG, status, hw: MOCK_HW, check: SYSTEM_CHECK.map((c) => ({ id: c.name, name: c.name, ok: c.ok, detail: c.detail })), loaded: true, wizardDismissed: true })
      return
    }
    const [catalog, list, hw] = await Promise.all([e.catalog(), e.list(), e.hardware()])
    unsub?.()
    unsub = e.onStatus((s) => set((st) => ({ status: { ...st.status, [s.id]: s } })))
    set({ catalog, status: Object.fromEntries(list.map((s) => [s.id, s])), hw, loaded: true })
    void get().refreshCheck()
  },
  refreshCheck: async () => {
    const e = api()
    if (!e) return
    set({ checking: true })
    try { set({ check: await e.check() }) } finally { set({ checking: false }) }
  },
  install: async (id) => { await api()?.install(id) },
  pause: async (id) => { await api()?.pause(id) },
  cancel: async (id) => { await api()?.cancel(id) },
  importFolder: async () => {
    const r = (await api()?.importFolder()) ?? null
    const e = api()
    if (e) { const list = await e.list(); set({ status: Object.fromEntries(list.map((s) => [s.id, s])) }) }
    return r
  },
  installRecommended: async () => {
    const e = api()
    if (!e) return
    set({ installingAll: true })
    try { await e.installRecommended() } finally { set({ installingAll: false }); await get().refreshCheck() }
  },
  dismissWizard: () => set({ wizardDismissed: true })
}))

/** Assets, die die Basis-Installation braucht (Hardware-abhängig). */
export function requiredIds(hw: HardwareInfo | null): string[] {
  return ['silero-vad', 'transnetv2', 'llama-server', 'node-runtime', 'parakeet-v3', hw?.recommendedLlm ?? 'qwen3-14b']
}

export const fmtBytes = (n: number): string => (n >= 1e9 ? `${(n / 1e9).toFixed(1).replace('.', ',')} GB` : `${Math.round(n / 1e6)} MB`)
