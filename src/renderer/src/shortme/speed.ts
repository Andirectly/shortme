// Tempo dieses Rechners relativ zur Referenz der Dauer-Schätzung (shared/estimate.ts), aus dem letzten vollständigen Lauf.
const KEY = 'sm-speed'

export function getSpeed(): number {
  try { const v = Number(localStorage.getItem(KEY)); return v >= 0.3 && v <= 5 ? v : 1 } catch { return 1 }
}

export function saveSpeed(v: number): void {
  try { localStorage.setItem(KEY, String(Math.max(0.3, Math.min(5, v)))) } catch { /* ohne Speicher bleibt es bei 1 */ }
}
