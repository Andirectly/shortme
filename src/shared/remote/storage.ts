/**
 * Quellenschutz und Speicherbereinigung (Plan V3, Kap. 8). Reservierte Originale und nicht quittierte
 * Ergebnisse werden NIE automatisch gelöscht – reicht der Platz nicht, wird der neue Job blockiert.
 */

export interface SourceLease {
  leaseId: string
  sourceMediaId: string
  ownerProjectId: string
  pinnedForEdit: boolean
  retentionMode: 'keep-until-user-removes' | 'time-limited'
  retainUntil?: string
}

export interface StoredFile {
  path: string
  bytes: number
  kind: 'original' | 'proxy' | 'cache' | 'temp' | 'render-outbox'
  sourceMediaId?: string
  /** Outbox-Render: alle ACKs da? */
  acknowledged?: boolean
  lastAccess: number
}

/** Original geschützt? Eine aktive Edit-Reservierung schützt auch nach Ablauf eines Zeitlimits (Warnung statt Löschen). */
export function isProtected(f: StoredFile, leases: SourceLease[]): boolean {
  if (f.kind === 'render-outbox') return !f.acknowledged
  if (f.kind !== 'original') return false
  // Jede Lease schützt, auch abgelaufene: entfernt wird sie nur durch ausdrückliche Nutzerentscheidung.
  return leases.some((l) => l.sourceMediaId === f.sourceMediaId)
}

/** Abgelaufene, aber noch reservierte Leases: Nutzer fragen, ob Editierbarkeit aufgegeben wird. */
export const expiredLeases = (leases: SourceLease[], now: number): SourceLease[] =>
  leases.filter((l) => l.retentionMode === 'time-limited' && l.retainUntil !== undefined && Date.parse(l.retainUntil) < now)

const ORDER: StoredFile['kind'][] = ['temp', 'cache', 'proxy', 'render-outbox', 'original']

export type CleanupPlan = { ok: true; delete: StoredFile[] } | { ok: false; code: 'INSUFFICIENT_SPACE'; freeable: number }

/** Dateien zum Freigeben von `needBytes`: erst Temp, dann Cache, dann Proxy (älteste zuerst); Geschütztes nie. */
export function planCleanup(files: StoredFile[], leases: SourceLease[], freeBytes: number, needBytes: number): CleanupPlan {
  if (freeBytes >= needBytes) return { ok: true, delete: [] }
  const candidates = files
    .filter((f) => !isProtected(f, leases))
    .sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || a.lastAccess - b.lastAccess)
  const picked: StoredFile[] = []
  let free = freeBytes
  for (const f of candidates) {
    if (free >= needBytes) break
    picked.push(f)
    free += f.bytes
  }
  return free >= needBytes ? { ok: true, delete: picked } : { ok: false, code: 'INSUFFICIENT_SPACE', freeable: free - freeBytes }
}
