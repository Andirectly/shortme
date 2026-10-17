import { existsSync } from 'node:fs'
import { join, extname } from 'node:path'

export type QualityTier = 'draft' | 'standard' | 'high'

export interface ExportProfile { id: string; name: string; width: number; height: number; fps: number; maxSeconds?: number }

export const PROFILES: ExportProfile[] = [
  { id: 'tiktok', name: 'TikTok', width: 1080, height: 1920, fps: 30 },
  { id: 'reels', name: 'Reels', width: 1080, height: 1920, fps: 30, maxSeconds: 90 },
  { id: 'shorts', name: 'Shorts', width: 1080, height: 1920, fps: 30, maxSeconds: 180 }
]

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

/** Dateiname aus dem KI-Titel: Windows-verbotene Zeichen/Namen entfernen, Länge begrenzen. */
export function safeFileName(title: string, fallback = 'Clip'): string {
  let n = title
    .normalize('NFC')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.]+|[\s.]+$/g, '')
  if (n.length > 100) n = n.slice(0, 100).replace(/[\s.]+$/g, '')
  if (!n) n = fallback
  if (RESERVED.test(n)) n = `_${n}`
  return n
}

/** Freien Pfad finden: „Titel.mp4“, „Titel (2).mp4“, … */
export function uniquePath(dir: string, name: string, ext = '.mp4', exists: (p: string) => boolean = existsSync): string {
  const e = extname(ext) || ext
  let p = join(dir, `${name}${e}`)
  for (let i = 2; exists(p); i++) p = join(dir, `${name} (${i})${e}`)
  return p
}
