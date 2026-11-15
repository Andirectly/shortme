// Minimaler .npy-Leser (Version 1/2, C-Reihenfolge, float16/float32) für die Vektoren des Python-Workers. Keine Pickles, keine Objekt-Arrays.
import { readFile } from 'node:fs/promises'

const f16 = (h: number): number => {
  const s = (h & 0x8000) >> 15, e = (h & 0x7c00) >> 10, f = h & 0x03ff
  if (e === 0) return (s ? -1 : 1) * Math.pow(2, -14) * (f / 1024)
  if (e === 0x1f) return f ? NaN : (s ? -Infinity : Infinity)
  return (s ? -1 : 1) * Math.pow(2, e - 15) * (1 + f / 1024)
}

export interface Npy2D { rows: number; cols: number; data: Float32Array }

export function parseNpy(buf: Buffer): Npy2D {
  if (buf.length < 12 || buf.subarray(0, 6).toString('latin1') !== '\x93NUMPY') throw new Error('keine .npy-Datei')
  const major = buf[6]
  const hlen = major === 1 ? buf.readUInt16LE(8) : buf.readUInt32LE(8)
  const start = (major === 1 ? 10 : 12) + hlen
  const header = buf.subarray(major === 1 ? 10 : 12, start).toString('latin1')
  const descr = /'descr':\s*'([^']+)'/.exec(header)?.[1]
  const fortran = /'fortran_order':\s*(True|False)/.exec(header)?.[1]
  const shape = /'shape':\s*\(([^)]*)\)/.exec(header)?.[1]
  if (!descr || fortran !== 'False' || shape === undefined) throw new Error('npy-Kopf nicht unterstützt')
  const dims = shape.split(',').map((x) => x.trim()).filter(Boolean).map(Number)
  if (dims.length !== 2 || dims.some((d) => !Number.isInteger(d) || d < 0)) throw new Error('nur 2D-Arrays')
  const [rows, cols] = dims
  const n = rows * cols
  const data = new Float32Array(n)
  if (descr === '<f2') { if (buf.length - start < n * 2) throw new Error('npy abgeschnitten'); for (let i = 0; i < n; i++) data[i] = f16(buf.readUInt16LE(start + i * 2)) }
  else if (descr === '<f4') { if (buf.length - start < n * 4) throw new Error('npy abgeschnitten'); for (let i = 0; i < n; i++) data[i] = buf.readFloatLE(start + i * 4) }
  else throw new Error(`dtype ${descr} nicht unterstützt`)
  for (let i = 0; i < n; i++) if (!Number.isFinite(data[i])) throw new Error('nicht endliche Werte im Vektor')
  return { rows, cols, data }
}

export async function readNpy(path: string): Promise<Npy2D> { return parseNpy(await readFile(path)) }

/** Kosinus-Ähnlichkeit zweier Zeilen (Vektoren sind bereits normalisiert; hier trotzdem sicher). */
export function cosineRows(a: Npy2D, i: number, b: Npy2D, j: number): number {
  let dot = 0, na = 0, nb = 0
  for (let k = 0; k < a.cols; k++) { const x = a.data[i * a.cols + k], y = b.data[j * b.cols + k]; dot += x * y; na += x * x; nb += y * y }
  return na && nb ? dot / Math.sqrt(na * nb) : 0
}
