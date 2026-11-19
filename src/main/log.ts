import { appendFileSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

const MAX_BYTES = 10 * 1024 * 1024
/** Eine Sitzungsdatei darf höchstens so groß werden (danach nur noch Warnungen/Fehler). */
const SESSION_MAX = 20 * 1024 * 1024
const KEEP_SESSIONS = 30
let file: string | null = null
let sessionFile: string | null = null
let sessionBytes = 0

export const logDir = (): string => join(app.getPath('userData'), 'logs')
export const sessionsDir = (): string => join(logDir(), 'sessions')
/** Kennung dieser App-Sitzung (Startzeit) – Dateiname unter logs/sessions/. */
export const sessionId = new Date().toISOString().replace(/[:.]/g, '-')
export const currentSessionFile = (): string | null => sessionFile

const fmt = (p: unknown): string => (p instanceof Error ? `${p.message}\n${p.stack ?? ''}` : typeof p === 'string' ? p : (() => { try { return JSON.stringify(p) } catch { return String(p) } })())

function write(level: string, parts: unknown[]): void {
  if (!file) return
  try {
    const line = `${new Date().toISOString()} ${level} ${parts.map(fmt).join(' ')}\n`
    try { if (statSync(file).size > MAX_BYTES) renameSync(file, `${file}.1`) } catch { /* Datei existiert noch nicht */ }
    appendFileSync(file, line)
    if (sessionFile && (sessionBytes < SESSION_MAX || level !== 'INFO')) { appendFileSync(sessionFile, line); sessionBytes += line.length }
  } catch { /* Logging darf nie die App stören */ }
}

/**
 * Datei-Log: <userData>/logs/shortme.log (alle Sitzungen, 10 MB, eine Rotation) und je App-Start eine eigene Datei
 * logs/sessions/<Start>.log (die letzten 30 bleiben). Erfasst alles, was die App meldet: console.*, unbehandelte Fehler,
 * Meldungen der Oberfläche (siehe attachWindowLog), Job-Verlauf (jobs.ts).
 */
export function initLog(): void {
  mkdirSync(sessionsDir(), { recursive: true })
  file = join(logDir(), 'shortme.log')
  sessionFile = join(sessionsDir(), `${sessionId}.log`)
  try { for (const f of readdirSync(sessionsDir()).filter((x) => x.endsWith('.log')).sort().reverse().slice(KEEP_SESSIONS)) rmSync(join(sessionsDir(), f), { force: true }) } catch { /* nur Aufräumen */ }
  const { log, info, warn, error, debug } = console
  console.log = (...a: unknown[]): void => { write('INFO', a); log(...a) }
  console.info = (...a: unknown[]): void => { write('INFO', a); info(...a) }
  console.debug = (...a: unknown[]): void => { write('DEBUG', a); debug(...a) }
  console.warn = (...a: unknown[]): void => { write('WARN', a); warn(...a) }
  console.error = (...a: unknown[]): void => { write('ERROR', a); error(...a) }
  process.on('uncaughtException', (e) => write('FATAL', [e]))
  process.on('unhandledRejection', (e) => write('ERROR', ['unhandledRejection', e]))
  write('INFO', [`Shortme gestartet (${app.getVersion()}, ${process.platform} ${process.arch}, Electron ${process.versions.electron}), Sitzung ${sessionId}`])
}

export const logInfo = (...a: unknown[]): void => write('INFO', a)
export const logError = (...a: unknown[]): void => write('ERROR', a)

/** Meldungen der Oberfläche (Renderer-Konsole, Abstürze, Hänger) ins selbe Log. */
export function attachWindowLog(wc: Electron.WebContents): void {
  wc.on('console-message', (...args: unknown[]) => {
    // Electron ≥ 35: ein Ereignis-Objekt; ältere: (event, level, message, line, sourceId)
    const ev = args[0] as { level?: string | number; message?: string; lineNumber?: number; sourceUrl?: string }
    const level = typeof ev?.level === 'string' ? ev.level : (['debug', 'info', 'warning', 'error'][Number(args[1])] ?? 'info')
    const message = ev?.message ?? String(args[2] ?? '')
    const where = ev?.sourceUrl ?? String(args[4] ?? '')
    const line = ev?.lineNumber ?? args[3]
    write(level === 'error' ? 'ERROR' : level === 'warning' ? 'WARN' : 'INFO', [`[Oberfläche] ${message}`, where ? `(${where.split('/').pop()}:${line})` : ''])
  })
  wc.on('render-process-gone', (_e, d) => write('FATAL', ['[Oberfläche] Renderer beendet', d]))
  wc.on('unresponsive', () => write('WARN', ['[Oberfläche] reagiert nicht']))
  wc.on('responsive', () => write('INFO', ['[Oberfläche] reagiert wieder']))
  wc.on('did-fail-load', (_e, code, desc, url) => write('ERROR', ['[Oberfläche] Laden fehlgeschlagen', code, desc, url]))
}
