import { join } from 'node:path'
import { app } from 'electron'

/** Datenordner für Modelle/Engines. `SHORTME_DATA` überschreibt (Tests, frische Installation simulieren). */
export function dataRoot(): string {
  if (process.env.SHORTME_DATA) return process.env.SHORTME_DATA
  // `app` ist außerhalb von Electron (Skripte/Tests) undefined.
  const base = app?.getPath?.('userData') ?? join(process.cwd(), '.tmp', 'userData')
  return base
}

export const modelsRoot = (): string => join(dataRoot(), 'models')
export const assetDir = (id: string): string => join(modelsRoot(), id)
/** Gebündelte Node-Laufzeit (Asset 'node-runtime'): ASR-Worker und yt-dlp (YouTube-JS-Challenges). */
export const nodeRuntimeExe = (): string => join(assetDir('node-runtime'), 'node-v22.23.3-win-x64', 'node.exe')
export const runDir = (): string => join(dataRoot(), 'run')
