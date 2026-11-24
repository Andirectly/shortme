/** Remote Engine: Daten für Einstellungen/Geräteliste (Hauptprozess → Renderer). */
import type { ConnectivityState, DevicePermissions } from './protocol'

export interface RemoteSettings {
  /** „Enable remote worker“: P2P-Host läuft, gekoppelte Geräte können verbinden. */
  enabled: boolean
  /** Nach der Anmeldung am Rechner automatisch (versteckt) starten. */
  startAtLogin: boolean
  /** Fenster schließen beendet den Worker nicht (Tray/Menüleiste bleibt). */
  keepRunningInBackground: boolean
  /** Anzeigename dieses Rechners für andere Geräte. */
  deviceName: string
  /** Öffentlicher Schlüssel eines selbst gewählten E2E-Blind-Relays (hex, 64 Zeichen); leer = nur direkt. */
  relayKey: string
}

export interface RemoteDeviceView {
  deviceId: string
  name: string
  platform: string
  connectivity: ConnectivityState
  route: 'direct' | 'relay' | 'unknown'
  lastSeenAt?: string
  pairedAt: string
  permissions: DevicePermissions
}

export interface RemoteOverview {
  settings: RemoteSettings
  /** null = Host läuft nicht (aus oder Fehler). */
  thisDevice: { deviceId: string; name: string; platform: string } | null
  error?: { code: string; message: string }
  devices: RemoteDeviceView[]
  invite?: { code: string; expiresAt: string }
  pairRequests: Array<{ deviceId: string; name: string; platform: string; fingerprint: string }>
  /** Von hier an andere Geräte gesendete Aufträge. */
  jobs: RemoteJobView[]
  /** Auf diesem Rechner für andere Geräte laufende Aufträge. */
  workerJobs: Array<{ jobId: string; from: string; url: string; compute: string; stage?: string; error?: string; published: number; pendingOffers: number; updatedAt: string }>
}

export interface RemoteJobView {
  jobId: string
  deviceId: string
  deviceName: string
  url: string
  title: string
  createdAt: string
  /** Zustand der Verarbeitung auf dem Worker (zuletzt bekannt, wenn offline). */
  compute: string
  stage?: string
  progress?: number
  lastUpdateAt?: string
  rejected?: { code: string; message: string }
  workerOnline: boolean
  projectHash?: string
  projectImported: boolean
  bundleDone: number
  bundleTotal?: number
  clipsReady: number
  clipsPending: number
}
