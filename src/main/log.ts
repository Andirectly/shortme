import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

const MAX_BYTES = 2 * 1024 * 1024
let file: string | null = null

export const logDir = (): string => join(app.getPath('userData'), 'logs')

function write(level: string, parts: unknown[]): void {
  if (!file) return
  try {
    try { if (statSync(file).size > MAX_BYTES) renameSync(file, `${file}.1`) } catch { /* Datei existiert noch nicht */ }
    const text = parts.map((p) => (p instanceof Error ? `${p.message}\n${p.stack ?? ''}` : typeof p === 'string' ? p : JSON.stringify(p))).join(' ')
    appendFileSync(file, `${new Date().toISOString()} ${level} ${text}\n`)
  } catch { /* Logging darf nie die App stören */ }
}

/** Datei-Log unter <userData>/logs/shortme.log (2 MB, eine Rotation): console.warn/error und unbehandelte Fehler. */
export function initLog(): void {
  mkdirSync(logDir(), { recursive: true })
  file = join(logDir(), 'shortme.log')
  const { warn, error } = console
  console.warn = (...a: unknown[]): void => { write('WARN', a); warn(...a) }
  console.error = (...a: unknown[]): void => { write('ERROR', a); error(...a) }
  process.on('uncaughtException', (e) => write('FATAL', [e]))
  process.on('unhandledRejection', (e) => write('ERROR', ['unhandledRejection', e]))
  write('INFO', [`Shortme gestartet (${app.getVersion()}, ${process.platform} ${process.arch}, Electron ${process.versions.electron})`])
}

export const logInfo = (...a: unknown[]): void => write('INFO', a)
