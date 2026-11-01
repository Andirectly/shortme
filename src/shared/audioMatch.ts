// Tonabgleich Short → Langvideo (Kreuzkorrelation von Spektralmerkmalen) und Rückfall über Wortfolgen. Rein, ohne Dateizugriff.

export const FEAT_SR = 8000
/** Merkmale je 0,1 s: 8 Bänder, Logenergie minus gleitender Mittelwert (unabhängig von Lautstärke und Rauschteppich). */
export const FEAT_FPS = 10
export const BANDS = 8
const EDGES = [3, 6, 11, 20, 36, 64, 110, 180, 256]

function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]] }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    for (let i = 0; i < n; i += len) for (let k = 0; k < len / 2; k++) {
      const wr = Math.cos(ang * k), wi = Math.sin(ang * k)
      const a = i + k, b = i + k + len / 2
      const xr = re[b] * wr - im[b] * wi, xi = re[b] * wi + im[b] * wr
      re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi
    }
  }
}

/** PCM (8 kHz, mono) → Merkmale [Frame × BANDS], flach. */
export function features(pcm: ArrayLike<number>): Float32Array {
  const hop = FEAT_SR / FEAT_FPS
  const frames = Math.max(0, Math.floor((pcm.length - 512) / hop) + 1)
  const out = new Float32Array(frames * BANDS)
  const re = new Float32Array(512), im = new Float32Array(512)
  for (let f = 0; f < frames; f++) {
    for (let i = 0; i < 512; i++) { re[i] = (pcm[f * hop + i] ?? 0) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / 511)); im[i] = 0 }
    fft(re, im)
    for (let b = 0; b < BANDS; b++) {
      let e = 0
      for (let k = EDGES[b]; k < EDGES[b + 1]; k++) e += re[k] * re[k] + im[k] * im[k]
      out[f * BANDS + b] = Math.log(1 + e / (EDGES[b + 1] - EDGES[b]))
    }
  }
  // gleitender Mittelwert (±5 Frames) je Band abziehen
  const R = 5
  for (let b = 0; b < BANDS; b++) {
    const col = new Float32Array(frames)
    for (let f = 0; f < frames; f++) col[f] = out[f * BANDS + b]
    let sum = 0, lo = 0, hi = -1
    for (let f = 0; f < frames; f++) {
      while (hi < Math.min(frames - 1, f + R)) sum += col[++hi]
      while (lo < f - R) sum -= col[lo++]
      out[f * BANDS + b] = col[f] - sum / (hi - lo + 1)
    }
  }
  return out
}

export interface Moment { start: number; end: number; score: number }

interface Hit { s: number; o: number; score: number }

/** Beste Stelle für einen Ausschnitt der Länge n Frames (Start s im Short) in der Langvideo-Merkmalsfolge. */
function bestOffset(short: Float32Array, s: number, n: number, long: Float32Array, longNorm: Float64Array): Hit | null {
  const frames = long.length / BANDS
  if (frames < n) return null
  let cn = 0
  for (let i = s * BANDS; i < (s + n) * BANDS; i++) cn += short[i] * short[i]
  if (cn < 1e-6) return null
  const scores = new Float32Array(frames - n + 1)
  let best = -1, bestO = 0
  for (let o = 0; o + n <= frames; o++) {
    let dot = 0
    const base = o * BANDS, sb = s * BANDS, len = n * BANDS
    for (let i = 0; i < len; i++) dot += short[sb + i] * long[base + i]
    const wn = longNorm[o + n] - longNorm[o]
    const sc = wn > 1e-6 ? dot / Math.sqrt(cn * wn) : 0
    scores[o] = sc
    if (sc > best) { best = sc; bestO = o }
  }
  // zweitbeste Stelle außerhalb von ±1 s: das Ergebnis muss eindeutig sein (Wiederholungen/Musik sonst Fehltreffer)
  let second = -1
  for (let o = 0; o < scores.length; o++) if (Math.abs(o - bestO) > FEAT_FPS && scores[o] > second) second = scores[o]
  return best - Math.max(second, 0) >= 0.12 ? { s, o: bestO, score: best } : null
}

/**
 * Abschnitte des Langvideos, die im Short vorkommen. Der Short wird in 4-s-Stücke geteilt, jedes einzeln gesucht;
 * Stücke mit gleichem Versatz (±0,3 s) werden zu einem Abschnitt, so entstehen bei Schnitten im Short mehrere Abschnitte.
 */
export function locate(short: Float32Array, long: Float32Array, opts: { minScore?: number; chunkSec?: number } = {}): Moment[] {
  const n = Math.round((opts.chunkSec ?? 4) * FEAT_FPS)
  const minScore = opts.minScore ?? 0.5
  const sf = short.length / BANDS, lf = long.length / BANDS
  const longNorm = new Float64Array(lf + 1)
  for (let f = 0; f < lf; f++) { let e = 0; for (let b = 0; b < BANDS; b++) e += long[f * BANDS + b] ** 2; longNorm[f + 1] = longNorm[f] + e }
  const hits: Hit[] = []
  for (let s = 0; s + n <= sf; s += n) { const h = bestOffset(short, s, n, long, longNorm); if (h && h.score >= minScore) hits.push(h) }
  const groups: Hit[][] = []
  for (const h of hits) {
    const g = groups[groups.length - 1]
    const last = g?.[g.length - 1]
    if (g && last && h.s - last.s === n && Math.abs(h.o - h.s - (last.o - last.s)) <= 3) g.push(h); else groups.push([h])
  }
  return groups.map((g) => {
    let a = g[0].o, b = g[g.length - 1].o + n
    const d = g[0].o - g[0].s
    // Ränder um bis zu 3 s verlängern, solange die einzelnen Frames noch zusammenpassen
    const frameSim = (sFr: number): number => {
      const oFr = sFr + d
      if (sFr < 0 || sFr >= sf || oFr < 0 || oFr >= lf) return 0
      let dot = 0, x = 0, y = 0
      for (let k = 0; k < BANDS; k++) { const p = short[sFr * BANDS + k], q = long[oFr * BANDS + k]; dot += p * q; x += p * p; y += q * q }
      return x > 1e-6 && y > 1e-6 ? dot / Math.sqrt(x * y) : 0
    }
    for (let i = 0; i < 3 * FEAT_FPS && frameSim(g[0].s - 1 - i) > 0.3; i++) a--
    const lastS = g[g.length - 1].s + n
    for (let i = 0; i < 3 * FEAT_FPS && frameSim(lastS + i) > 0.3; i++) b++
    return { start: Math.max(0, a) / FEAT_FPS, end: Math.min(lf, b) / FEAT_FPS, score: g.reduce((s, h) => s + h.score, 0) / g.length }
  })
}

const norm = (w: string): string => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')

/** Rückfall: gleiche Wortfolgen (4-Gramme) in Short und Langvideo; Abschnitt = zusammenhängende Treffer auf derselben Diagonale. */
export function matchByText(shortWords: string[], long: Array<{ w: string; start: number; end: number }>, minWords = 8): Moment[] {
  const sw = shortWords.map(norm), lw = long.map((x) => norm(x.w))
  const N = 4
  const idx = new Map<string, number[]>()
  for (let j = 0; j + N <= lw.length; j++) { const k = lw.slice(j, j + N).join(' '); if (k.replace(/ /g, '')) idx.set(k, [...(idx.get(k) ?? []), j]) }
  const byDiag = new Map<number, number[]>()
  for (let i = 0; i + N <= sw.length; i++) for (const j of idx.get(sw.slice(i, i + N).join(' ')) ?? []) {
    if (idx.get(sw.slice(i, i + N).join(' '))!.length > 3) break // Floskeln kommen oft vor → mehrdeutig
    byDiag.set(j - i, [...(byDiag.get(j - i) ?? []), i])
  }
  const out: Moment[] = []
  for (const [d, is] of byDiag) {
    is.sort((a, b) => a - b)
    let from = is[0], prev = is[0]
    const flush = (to: number): void => {
      const len = to + N - from
      if (len < minWords) return
      const a = long[from + d], b = long[Math.min(long.length - 1, to + d + N - 1)]
      if (a && b) out.push({ start: a.start, end: b.end, score: Math.min(1, len / Math.max(1, sw.length)) })
    }
    for (const i of is.slice(1)) { if (i - prev > 3) { flush(prev); from = i } prev = i }
    flush(prev)
  }
  return out.sort((a, b) => a.start - b.start).filter((m, k, all) => !all.slice(0, k).some((o) => o.start <= m.start && o.end >= m.end))
}
