/**
 * Vier getrennte Zustandsmaschinen (Plan V3, Kap. 7). Compute ist auf dem Worker autoritativ;
 * Verbindung, Übertragung und Freigabe ändern Compute nie (ein offline Client pausiert keinen Job).
 */
import type { ComputeState, DeliveryState, ReleaseState } from './protocol'

const PIPELINE: ComputeState[] = ['created', 'queued', 'accepted', 'acquiring-source', 'preparing', 'transcribing', 'analyzing', 'selecting', 'rendering', 'auditing', 'publishing', 'completed']
const TERMINAL: ComputeState[] = ['completed', 'failed', 'cancelled']

/** Erlaubter Compute-Übergang? Stufen dürfen übersprungen werden (nicht jede Engine nutzt alle), nie rückwärts – außer der Reparaturschleife. */
export function canMoveCompute(from: ComputeState, to: ComputeState): boolean {
  if (TERMINAL.includes(from)) return false
  if (to === 'failed' || to === 'cancelled') return true
  if (to === 'needs-input' || to === 'resource-paused') return from !== 'created'
  // Nach Pause/Eingabe: Neustart der persistierten Stufe (Stage-Journal), daher jede Pipelinestufe ab 'queued'.
  if (from === 'needs-input' || from === 'resource-paused') return PIPELINE.indexOf(to) >= PIPELINE.indexOf('queued')
  if (to === 'repairing') return from === 'auditing'
  if (from === 'repairing') return to === 'rendering' || to === 'auditing'
  const a = PIPELINE.indexOf(from)
  const b = PIPELINE.indexOf(to)
  return a >= 0 && b > a
}

const DELIVERY_NEXT: Record<DeliveryState, DeliveryState[]> = {
  announced: ['transferring', 'permanently-unavailable'],
  transferring: ['verified', 'retryable-error', 'permanently-unavailable'],
  verified: ['imported', 'retryable-error'],
  imported: ['acknowledged'],
  acknowledged: [],
  'retryable-error': ['transferring', 'permanently-unavailable'],
  'permanently-unavailable': []
}
export const canMoveDelivery = (from: DeliveryState, to: DeliveryState): boolean => DELIVERY_NEXT[from].includes(to)

/** Clip-Kachel im Client. `Ready` nur bei `published` UND importiertem Asset. */
export type ClipTile = 'Processing' | 'Ready' | 'Needs review' | 'Repair failed' | 'Edited – rerender pending' | 'Preview ready'

export function clipTile(release: ReleaseState, delivery: DeliveryState | undefined, editedLocally = false): ClipTile {
  if (editedLocally) return 'Edited – rerender pending'
  if (release === 'audit-review') return 'Needs review'
  if (release === 'repair-required') return 'Repair failed'
  if (release === 'published') return delivery === 'imported' || delivery === 'acknowledged' ? 'Ready' : 'Preview ready'
  return 'Processing'
}

/** Projektzusammenfassung „3 Ready / 2 Processing / 1 Needs review“ – zählt Kachelzustände, täuscht keine Vollständigkeit vor. */
export function summarize(tiles: ClipTile[]): string {
  const order: ClipTile[] = ['Ready', 'Preview ready', 'Processing', 'Edited – rerender pending', 'Needs review', 'Repair failed']
  return order
    .map((t) => [t, tiles.filter((x) => x === t).length] as const)
    .filter(([, n]) => n > 0)
    .map(([t, n]) => `${n} ${t}`)
    .join(' / ')
}
