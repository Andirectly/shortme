import type { FileFacts, PlatformId, PlatformStatus, UploadJob } from '../../shared/upload'

/** Rückmeldung eines Uploads; `patch` wird in den Auftrag übernommen und gespeichert. */
export type Report = (patch: Partial<UploadJob>) => Promise<void>

export interface PlatformVideoStat { id: string; description: string; createdAt: number; views: number; likes: number; comments: number; shares: number }

/** Gemeinsame Schnittstelle: YouTube und Instagram kommen später als weitere Bausteine dazu. */
export interface Platform {
  id: PlatformId
  name: string
  status(): Promise<PlatformStatus>
  /** Anmeldung über den System-Browser. */
  connect(): Promise<void>
  disconnect(): Promise<void>
  /** Verstöße gegen die Dateivorgaben (leer = ok). */
  check(f: FileFacts): string[]
  upload(job: UploadJob, path: string, report: Report, signal?: AbortSignal): Promise<void>
  /** Teil 3 (nicht aktiviert): Aufrufzahlen der geposteten Videos zurücklesen. */
  fetchStats?(): Promise<PlatformVideoStat[]>
}

/** Ausgegraute Pille: Plattform ist vorgesehen, aber noch nicht gebaut. */
export const comingSoon = (id: PlatformId, name: string): Pick<Platform, 'id' | 'name'> & { status: () => Promise<PlatformStatus> } => ({
  id, name, status: async () => ({ id, name, available: false, connected: false })
})
