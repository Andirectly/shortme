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
export const runDir = (): string => join(dataRoot(), 'run')
