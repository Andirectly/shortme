// BoT-SORT-ReID, nach mikel-brostrom/boxmot (AGPL-3.0, private Nutzung): boxmot/trackers/botsort/{tracker,track,config}.py,
// trackers/common/association/matching.py, trackers/common/motion/kalman_filters/xywh.py.
// Weggelassen: Kamerabewegungs-Kompensation (Kameras stehen innerhalb einer Einstellung still).
// Angepasst: Zeitschritt = ein Erkennungsdurchlauf (5 Hz), Tracker startet an jedem Kamerawechsel neu.
import { finalizeTrack, SMOOTH_WINDOW_SEC, MIN_DETECTIONS, MIN_TRACK_SEC, type Detection, type FaceTrack } from './facetracks'
import { iou, type FaceBox } from './speaker'

export interface BotSortParams {
  /** Erkennungen oberhalb: Hochpool (neue Spuren, erste Zuordnung); zwischen low und high: Niedrigpool (zweite Zuordnung). */
  highThresh: number
  lowThresh: number
  newTrackThresh: number
  /** Schritte, die eine verlorene Spur auf Wiederfinden wartet. */
  maxLost: number
  matchThresh: number
  proximityThresh: number
  appearanceThresh: number
  secondMatchThresh: number
  unconfirmedMatchThresh: number
  unconfirmedEmbScale: number
  /** EMA-Faktor des Aussehens-Merkmals. */
  alpha: number
  duplicateThresh: number
}

/** Standardwerte aus boxmot/configs/trackers/botsort.yaml; Konfidenz-Schwellen an unsere Erkennerwerte angepasst (YuNet ≥ 0,75, SCRFD ≥ 0,5, Pose-Kopf 0,6). */
export const BOTSORT_DEFAULTS: BotSortParams = {
  highThresh: 0.5, lowThresh: 0.1, newTrackThresh: 0.5, maxLost: 10, matchThresh: 0.7722, proximityThresh: 0.6084, appearanceThresh: 0.6189,
  secondMatchThresh: 0.288, unconfirmedMatchThresh: 0.4115, unconfirmedEmbScale: 2.5445, alpha: 0.9, duplicateThresh: 0.15
}

// --- Kalman-Filter (xywh, 8 Zustände) ------------------------------------------------------------

type Mat = number[][]
const STD_POS = 1 / 20
const STD_VEL = 1 / 160
const eye = (n: number): Mat => Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)))
const mul = (a: Mat, b: Mat): Mat => a.map((r) => b[0].map((_, j) => r.reduce((s, v, k) => s + v * b[k][j], 0)))
const tr = (a: Mat): Mat => a[0].map((_, j) => a.map((r) => r[j]))
const add = (a: Mat, b: Mat): Mat => a.map((r, i) => r.map((v, j) => v + b[i][j]))
const sub = (a: Mat, b: Mat): Mat => a.map((r, i) => r.map((v, j) => v - b[i][j]))
const diag = (d: number[]): Mat => d.map((v, i) => d.map((_, j) => (i === j ? v : 0)))

/** Inverse einer kleinen Matrix (Gauß-Jordan mit Pivotsuche). */
export function invert(m: Mat): Mat {
  const n = m.length
  const a = m.map((r, i) => [...r, ...eye(n)[i]])
  for (let c = 0; c < n; c++) {
    let p = c
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r
    if (Math.abs(a[p][c]) < 1e-12) throw new Error('Matrix singulär')
    ;[a[c], a[p]] = [a[p], a[c]]
    const d = a[c][c]
    for (let j = 0; j < 2 * n; j++) a[c][j] /= d
    for (let r = 0; r < n; r++) if (r !== c) { const f = a[r][c]; if (f) for (let j = 0; j < 2 * n; j++) a[r][j] -= f * a[c][j] }
  }
  return a.map((r) => r.slice(n))
}

export interface KState { mean: number[]; cov: Mat }
const H: Mat = [[1, 0, 0, 0, 0, 0, 0, 0], [0, 1, 0, 0, 0, 0, 0, 0], [0, 0, 1, 0, 0, 0, 0, 0], [0, 0, 0, 1, 0, 0, 0, 0]]
const F = (): Mat => { const f = eye(8); for (let i = 0; i < 4; i++) f[i][4 + i] = 1; return f }

export function kInit(z: number[]): KState {
  const [, , w, h] = z
  return { mean: [...z, 0, 0, 0, 0], cov: diag([2 * STD_POS * w, 2 * STD_POS * h, 2 * STD_POS * w, 2 * STD_POS * h, 10 * STD_VEL * w, 10 * STD_VEL * h, 10 * STD_VEL * w, 10 * STD_VEL * h].map((v) => v * v)) }
}
export function kPredict(s: KState): KState {
  const [, , w, h] = s.mean
  const q = diag([STD_POS * w, STD_POS * h, STD_POS * w, STD_POS * h, STD_VEL * w, STD_VEL * h, STD_VEL * w, STD_VEL * h].map((v) => v * v))
  const f = F()
  return { mean: f.map((r) => r.reduce((sum, v, k) => sum + v * s.mean[k], 0)), cov: add(mul(mul(f, s.cov), tr(f)), q) }
}
export function kUpdate(s: KState, z: number[]): KState {
  const [, , w, h] = s.mean
  const r = diag([STD_POS * w, STD_POS * h, STD_POS * w, STD_POS * h].map((v) => v * v))
  const S = add(mul(mul(H, s.cov), tr(H)), r)
  const K = mul(mul(s.cov, tr(H)), invert(S))
  const innov = z.map((v, i) => v - s.mean[i])
  const mean = s.mean.map((v, i) => v + K[i].reduce((sum, k, j) => sum + k * innov[j], 0))
  return { mean, cov: sub(s.cov, mul(mul(K, S), tr(K))) }
}

// --- Zuordnung -----------------------------------------------------------------------------------

/** Lineare Zuordnung (Hungarian, rechteckig): minimiert die Summe der Kosten; gibt (Zeile, Spalte)-Paare zurück. */
export function hungarian(cost: Mat): Array<[number, number]> {
  const nr = cost.length, nc = nr ? cost[0].length : 0
  if (!nr || !nc) return []
  const n = Math.max(nr, nc)
  const BIG = 1e6
  const c = Array.from({ length: n + 1 }, (_, i) => Array.from({ length: n + 1 }, (_, j) => (i >= 1 && j >= 1 && i <= nr && j <= nc ? cost[i - 1][j - 1] : i >= 1 && j >= 1 ? BIG : 0)))
  const u = new Array(n + 1).fill(0), v = new Array(n + 1).fill(0), p = new Array(n + 1).fill(0), way = new Array(n + 1).fill(0)
  for (let i = 1; i <= n; i++) {
    p[0] = i
    let j0 = 0
    const minv = new Array(n + 1).fill(Infinity), used = new Array(n + 1).fill(false)
    do {
      used[j0] = true
      const i0 = p[j0]
      let delta = Infinity, j1 = 0
      for (let j = 1; j <= n; j++) if (!used[j]) {
        const cur = c[i0][j] - u[i0] - v[j]
        if (cur < minv[j]) { minv[j] = cur; way[j] = j0 }
        if (minv[j] < delta) { delta = minv[j]; j1 = j }
      }
      for (let j = 0; j <= n; j++) { if (used[j]) { u[p[j]] += delta; v[j] -= delta } else minv[j] -= delta }
      j0 = j1
    } while (p[j0] !== 0)
    do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1 } while (j0)
  }
  const out: Array<[number, number]> = []
  for (let j = 1; j <= n; j++) if (p[j] >= 1 && p[j] <= nr && j <= nc) out.push([p[j] - 1, j - 1])
  return out
}

export const cosineDist = (a: ArrayLike<number>, b: ArrayLike<number>): number => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return Math.max(0, 1 - s) }

const toZ = (b: FaceBox): number[] => [(b.x1 + b.x2) / 2, (b.y1 + b.y2) / 2, b.x2 - b.x1, b.y2 - b.y1]
const fromMean = (m: number[]): FaceBox => ({ x1: m[0] - m[2] / 2, y1: m[1] - m[3] / 2, x2: m[0] + m[2] / 2, y2: m[1] + m[3] / 2, score: 1 })
const norm = (v: Float32Array): Float32Array => { let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n) || 1; return v.map((x) => x / n) }

export interface TDet { box: FaceBox; emb?: Float32Array }
type TState = 'tentative' | 'tracked' | 'lost'
interface Trk { id: number; k: KState; state: TState; feat?: Float32Array; dets: Detection[]; lastStep: number; missedAt?: number; born: number }

/** Kostenmatrix der ersten Zuordnung (Tracks × Erkennungen): min(IoU-Distanz, Aussehens-Distanz) mit Näherungs- und Aussehens-Schwelle. */
export function associationCost(tracks: Array<{ box: FaceBox; feat?: Float32Array }>, dets: TDet[], p: BotSortParams, embScale = 1, useReid = true): Mat {
  return tracks.map((t) => dets.map((d) => {
    let dIou = 1 - iou(t.box, d.box)
    const mask = dIou > p.proximityThresh
    dIou = 1 - (1 - dIou) * d.box.score // fuse_score
    if (!useReid || !t.feat || !d.emb) return dIou
    let dEmb = cosineDist(t.feat, d.emb) / embScale
    if (dEmb > p.appearanceThresh) dEmb = 1
    if (mask) dEmb = 1
    return Math.min(dIou, dEmb)
  }))
}

function solve(cost: Mat, thresh: number, nc: number): { matches: Array<[number, number]>; unT: number[]; unD: number[] } {
  const nr = cost.length
  const matches = hungarian(cost).filter(([i, j]) => cost[i][j] <= thresh)
  const mt = new Set(matches.map((m) => m[0])), md = new Set(matches.map((m) => m[1]))
  return { matches, unT: Array.from({ length: nr }, (_, i) => i).filter((i) => !mt.has(i)), unD: Array.from({ length: nc }, (_, j) => j).filter((j) => !md.has(j)) }
}

/**
 * Spuren über eine Einstellung (Frames zwischen zwei Kamerawechseln). `steps[k]` = Erkennungen zum Frame `frames[k]`.
 * Liefert je Spur die zugeordneten Erkennungen (nur echte Erkennungen, keine Vorhersagen) und das Ende der Spur.
 */
export function trackShot(frames: number[], steps: TDet[][], stop: number, p: BotSortParams = BOTSORT_DEFAULTS, useReid = true): Array<{ detections: Detection[]; end: number }> {
  let nextId = 1
  let pool: Trk[] = []
  const finished: Array<{ detections: Detection[]; end: number }> = []
  const finish = (t: Trk, stopFrame: number): void => {
    const last = t.dets[t.dets.length - 1].frame
    const end = Math.max(last, Math.min(stopFrame, t.missedAt ?? stopFrame) - 1)
    finished.push({ detections: t.dets, end })
  }
  for (let s = 0; s < steps.length; s++) {
    const frame = frames[s]
    const dets = steps[s].map((d) => ({ ...d, emb: d.emb ? norm(d.emb) : undefined }))
    const high = dets.filter((d) => d.box.score >= p.highThresh)
    const low = dets.filter((d) => d.box.score >= p.lowThresh && d.box.score < p.highThresh)
    // Vorhersage (verlorene Spuren: Größen-Geschwindigkeit zurücksetzen wie in boxmot)
    for (const t of pool) {
      if (t.state !== 'tracked') { t.k.mean[6] = 0; t.k.mean[7] = 0 }
      t.k = kPredict(t.k)
    }
    const confirmed = pool.filter((t) => t.state !== 'tentative')
    const tentative = pool.filter((t) => t.state === 'tentative')
    const apply = (t: Trk, d: TDet): void => {
      t.k = kUpdate(t.k, toZ(d.box))
      t.dets.push({ frame, box: d.box })
      t.state = 'tracked'
      t.lastStep = s
      t.missedAt = undefined
      if (d.emb) t.feat = t.feat ? norm(t.feat.map((v, i) => p.alpha * v + (1 - p.alpha) * d.emb![i])) : d.emb
    }
    // 1) bestätigte + verlorene Spuren gegen den Hochpool (Position + Aussehen)
    const r1 = solve(associationCost(confirmed.map((t) => ({ box: fromMean(t.k.mean), feat: t.feat })), high, p, 1, useReid), p.matchThresh, high.length)
    for (const [i, j] of r1.matches) apply(confirmed[i], high[j])
    // 2) noch nicht zugeordnete verfolgte Spuren gegen den Niedrigpool (nur Geometrie)
    const rem = r1.unT.map((i) => confirmed[i]).filter((t) => t.state === 'tracked')
    const r2 = solve(associationCost(rem.map((t) => ({ box: fromMean(t.k.mean) })), low, p, 1, false), p.secondMatchThresh, low.length)
    for (const [i, j] of r2.matches) apply(rem[i], low[j])
    const lostNow = rem.filter((_, i) => r2.unT.includes(i))
    for (const t of lostNow) { t.state = 'lost'; t.missedAt ??= frame }
    // 3) unbestätigte Spuren gegen übrige Hochpool-Erkennungen (Aussehen skaliert)
    const left = r1.unD.map((j) => high[j])
    const r3 = solve(associationCost(tentative.map((t) => ({ box: fromMean(t.k.mean), feat: t.feat })), left, p, p.unconfirmedEmbScale, useReid), p.unconfirmedMatchThresh, left.length)
    for (const [i, j] of r3.matches) apply(tentative[i], left[j])
    for (const i of r3.unT) { const t = tentative[i]; t.state = 'lost'; t.missedAt ??= frame; t.lastStep = -999 } // unbestätigt ohne Treffer: entfernt
    // 4) neue Spuren
    const fresh = r3.unD.map((j) => left[j]).filter((d) => d.box.score >= p.newTrackThresh)
    for (const d of fresh) pool.push({ id: nextId++, k: kInit(toZ(d.box)), state: 'tentative', feat: d.emb, dets: [{ frame, box: d.box }], lastStep: s, born: s })
    // 5) zu lange verlorene/entfernte Spuren abschließen; Duplikate (gleicher Ort) entfernen
    const keep: Trk[] = []
    for (const t of pool) {
      if (t.lastStep === -999 || (t.state === 'lost' && s - t.lastStep > p.maxLost)) { finish(t, frame); continue }
      keep.push(t)
    }
    pool = keep
    const dup = new Set<Trk>()
    const act = pool.filter((t) => t.state === 'tracked'), lost = pool.filter((t) => t.state === 'lost')
    for (const a of act) for (const l of lost) if (1 - iou(fromMean(a.k.mean), fromMean(l.k.mean)) < p.duplicateThresh) dup.add(a.dets.length >= l.dets.length ? l : a)
    for (const d of dup) finish(d, frame)
    pool = pool.filter((t) => !dup.has(t))
  }
  for (const t of pool) finish(t, stop)
  return finished
}

/**
 * Drop-in-Ersatz für `buildFaceTracks`: gleiche Eingabe (+ Aussehens-Merkmale je Erkennung), gleiche Ausgabe (geglättete Boxen je Frame).
 * `emb[f][i]` gehört zu `facesPerFrame[f][i]`.
 */
export function buildBotSortTracks(facesPerFrame: Array<FaceBox[] | null>, emb: Array<Array<Float32Array | undefined> | null>, sceneCuts: number[], fps: number, p: BotSortParams = BOTSORT_DEFAULTS, useReid = true): FaceTrack[] {
  const cuts = [...new Set(sceneCuts)].sort((a, b) => a - b)
  const bounds = [0, ...cuts.filter((c) => c > 0 && c < facesPerFrame.length), facesPerFrame.length]
  const minLen = Math.max(2, Math.round(MIN_TRACK_SEC * fps))
  const smooth = Math.max(3, Math.round(SMOOTH_WINDOW_SEC * fps)) | 1
  const out: FaceTrack[] = []
  for (let b = 0; b + 1 < bounds.length; b++) {
    const frames: number[] = [], steps: TDet[][] = []
    for (let f = bounds[b]; f < bounds[b + 1]; f++) {
      const faces = facesPerFrame[f]
      if (!faces) continue
      frames.push(f)
      steps.push(faces.map((box, i) => ({ box, emb: emb[f]?.[i] })))
    }
    for (const t of trackShot(frames, steps, bounds[b + 1], p, useReid)) {
      if (t.detections.length >= MIN_DETECTIONS && t.end - t.detections[0].frame + 1 >= minLen) out.push(finalizeTrack(t.detections, smooth, t.end))
    }
  }
  return out
}
