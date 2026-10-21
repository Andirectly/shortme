// Wortvergleich zweier Transkripte (Testlab „Clip-Transkription“) und Übernahme von Schreibweisen aus einem zweiten Durchgang.

export type DiffKind = 'same' | 'sub' | 'ins' | 'del'
export interface DiffOp { kind: DiffKind; /** Index in A (Standard) – fehlt bei ins */ a?: number; /** Index in B (zweiter Durchgang) – fehlt bei del */ b?: number }

export const norm = (w: string): string => w.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, '')

/** Ähnlichkeit 0..1 zweier Wörter (1 − Levenshtein/Länge). */
export function similarity(x: string, y: string): number {
  const a = norm(x), b = norm(y)
  if (a === b) return 1
  if (!a.length || !b.length) return 0
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]
    prev[0] = i
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1))
      diag = tmp
    }
  }
  return 1 - prev[b.length] / Math.max(a.length, b.length)
}

/** Ausrichtung per dynamischer Programmierung (Gleiches/Ersetzen/Einfügen/Löschen); Ersetzen nur bei ähnlichen Wörtern, sonst Löschen + Einfügen. */
export function alignWords(a: string[], b: string[]): DiffOp[] {
  const n = a.length, m = b.length
  const score: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  const sim = (i: number, j: number): number => similarity(a[i], b[j])
  for (let i = 1; i <= n; i++) score[i][0] = score[i - 1][0] - 1
  for (let j = 1; j <= m; j++) score[0][j] = score[0][j - 1] - 1
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const s = sim(i - 1, j - 1)
      const diag = score[i - 1][j - 1] + (s === 1 ? 2 : s >= 0.4 ? 2 * s - 0.6 : -2)
      score[i][j] = Math.max(diag, score[i - 1][j] - 1, score[i][j - 1] - 1)
    }
  }
  const ops: DiffOp[] = []
  let i = n, j = m
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0) {
      const s = sim(i - 1, j - 1)
      const diag = score[i - 1][j - 1] + (s === 1 ? 2 : s >= 0.4 ? 2 * s - 0.6 : -2)
      if (Math.abs(score[i][j] - diag) < 1e-9 && s >= 0.4) { ops.push({ kind: s === 1 ? 'same' : 'sub', a: i - 1, b: j - 1 }); i--; j--; continue }
    }
    if (i > 0 && Math.abs(score[i][j] - (score[i - 1][j] - 1)) < 1e-9) { ops.push({ kind: 'del', a: i - 1 }); i--; continue }
    if (j > 0) { ops.push({ kind: 'ins', b: j - 1 }); j-- } else { ops.push({ kind: 'del', a: i - 1 }); i-- }
  }
  return ops.reverse()
}

/**
 * Schreibweisen aus dem zweiten Durchgang übernehmen, ohne Wortzahl und Zeiten anzufassen: nur 1:1-Ersetzungen
 * (Index des Standard-Wortes → neuer Text). Einfügungen/Löschungen des zweiten Durchgangs bleiben unberücksichtigt.
 */
export function substitutions(standard: string[], second: string[]): Record<number, string> {
  const out: Record<number, string> = {}
  for (const op of alignWords(standard, second)) {
    // nur echte Wortänderungen (Groß-/Kleinschreibung und Satzzeichen bleiben wie im Standard)
    if (op.kind === 'sub' && op.a !== undefined && op.b !== undefined && norm(standard[op.a]) !== norm(second[op.b])) out[op.a] = second[op.b]
  }
  return out
}
