// Engine 6 – zeitliche Redundanzreduktion für AV-Pakete (Kap. 19): je Sekunde eine 32×18-Signatur (ein FFmpeg-Durchgang), gezeigt werden nur Sekunden,
// deren Bild sich vom zuletzt gezeigten unterscheidet, plus Kontrollbild spätestens alle `maxGapSec` und erste/letzte Sekunde. Der Ton bleibt vollständig.
// Reversibel: welche Sekunden gezeigt wurden, steht im Paketprotokoll; ein Repräsentant ist kein Beweis für die Zwischenbilder.
import { spawn } from 'node:child_process'
import { FFMPEG_PATH } from '../../../../pipeline/ffmpeg'
import { meanAbsDiff } from './visualIndex'

const SW = 32, SH = 18

export function secondSignatures(path: string, signal?: AbortSignal): Promise<Uint8Array[]> {
  return new Promise((resolve, reject) => {
    const p = spawn(FFMPEG_PATH, ['-hide_banner', '-loglevel', 'error', '-i', path, '-an', '-vf', `fps=1,scale=${SW}:${SH}:flags=area,format=gray`, '-f', 'rawvideo', 'pipe:1'], { windowsHide: true, signal })
    const out: Uint8Array[] = []
    let rest: Buffer = Buffer.alloc(0)
    p.stdout.on('data', (d: Buffer) => { rest = rest.length ? Buffer.concat([rest, d]) : d; while (rest.length >= SW * SH) { out.push(Uint8Array.from(rest.subarray(0, SW * SH))); rest = rest.subarray(SW * SH) } })
    p.on('error', reject)
    p.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`Signaturen fehlgeschlagen (Code ${code})`))))
  })
}

/** Reine Auswahl (getestet). */
export function keepSeconds(sigs: ArrayLike<number>[], o: { threshold: number; maxGapSec: number }): number[] {
  if (!sigs.length) return []
  const keep = [0]
  for (let i = 1; i < sigs.length; i++) {
    const last = keep[keep.length - 1]
    if (i === sigs.length - 1 || i - last >= o.maxGapSec || meanAbsDiff(sigs[i], sigs[last]) >= o.threshold) keep.push(i)
  }
  return keep
}
