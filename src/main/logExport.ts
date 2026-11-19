// Fehlerbericht: Systeminfo + Sitzungs-Logs als Textdatei (Downloads) und – falls der Bewertungskatalog eingerichtet ist –
// Upload ins private GitHub-Repo (logs/<Rechner>/…) über die Contents-API. Vorige Sitzungen werden beim nächsten Start hochgeladen.
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { cpus, hostname, release, totalmem, freemem } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'
import { currentSessionFile, logDir, logInfo, sessionsDir } from './log'
import { FFMPEG_PATH } from './pipeline/ffmpeg'
import { resolveEncoder } from './pipeline/encoders'
import { catalogTarget } from './learn/catalog'

const machine = hostname().replace(/[^\w.-]/g, '_')
/** GitHub-Contents-API: Dateien bis 1 MB ohne Sonderweg – längere Logs werden auf ihr Ende gekürzt. */
const UPLOAD_MAX = 900 * 1024
const uploadedFile = (): string => join(logDir(), 'uploaded.json')

const run = (bin: string, args: string[]): Promise<string> => new Promise((res) => execFile(bin, args, { windowsHide: true, timeout: 8000 }, (_e, out) => res(String(out ?? '').trim())))

async function systemInfo(): Promise<string> {
  const enc = await resolveEncoder('auto').catch((e: unknown) => ({ kind: `Fehler: ${String(e)}`, bin: '' }))
  const ff = (await run(FFMPEG_PATH, ['-hide_banner', '-version'])).split(/\r?\n/)[0]
  const encFf = enc.bin && enc.bin !== FFMPEG_PATH ? (await run(enc.bin, ['-hide_banner', '-version'])).split(/\r?\n/)[0] : ''
  const gpu = process.platform === 'win32' || process.platform === 'linux' ? await run('nvidia-smi', ['--query-gpu=name,driver_version,memory.total,memory.used', '--format=csv,noheader']) : ''
  return [
    `Shortme ${app.getVersion()} · ${process.platform} ${release()} ${process.arch} · Electron ${process.versions.electron} · Rechner ${machine}`,
    `CPU ${cpus()[0]?.model ?? '?'} ×${cpus().length} · RAM ${(totalmem() / 2 ** 30).toFixed(1)} GB (frei ${(freemem() / 2 ** 30).toFixed(1)} GB)`,
    `GPU ${gpu || 'nicht ermittelt'}`,
    `FFmpeg (gebündelt) ${FFMPEG_PATH} · ${ff || 'startet nicht'}`,
    `Export-Encoder ${enc.kind} · ${enc.bin}${encFf ? ` · ${encFf}` : ''}`,
    `Daten ${app.getPath('userData')}`
  ].join('\n')
}

const tail = (s: string, max: number): string => (s.length > max ? `… (gekürzt, Anfang fehlt)\n${s.slice(-max)}` : s)

async function sessionFiles(): Promise<string[]> {
  return (await readdir(sessionsDir()).catch(() => [] as string[])).filter((f) => f.endsWith('.log')).sort()
}

async function putFile(repo: string, token: string, path: string, text: string): Promise<void> {
  const r = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
    method: 'PUT', signal: AbortSignal.timeout(30_000),
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'Shortme', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: `Log ${path}`, content: Buffer.from(text, 'utf8').toString('base64') })
  })
  // 422 = gibt es schon (gleicher Name) – dann gilt es als hochgeladen
  if (!r.ok && r.status !== 422) throw new Error(`GitHub ${r.status}: ${(await r.text()).slice(0, 200)}`)
}

/** Fehlerbericht als Textdatei in Downloads; danach Upload (falls eingerichtet). */
export async function exportLogReport(): Promise<{ path: string; uploaded: string | null; uploadError: string | null }> {
  const files = await sessionFiles()
  const parts = [`# Shortme-Fehlerbericht ${new Date().toISOString()}`, '', await systemInfo(), '']
  // aktuelle + die zwei vorigen Sitzungen, neueste zuerst
  for (const f of files.slice(-3).reverse()) parts.push(`\n===== Sitzung ${f}${join(sessionsDir(), f) === currentSessionFile() ? ' (aktuell)' : ''} =====\n`, tail(await readFile(join(sessionsDir(), f), 'utf8').catch(() => ''), 3_000_000))
  const text = parts.join('\n')
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const name = `shortme-fehlerbericht-${machine}-${stamp}.txt`
  const path = join(app.getPath('downloads'), name)
  await writeFile(path, text, 'utf8')
  logInfo(`[Log] Fehlerbericht exportiert: ${path}`)
  let uploaded: string | null = null, uploadError: string | null = null
  try {
    const t = await catalogTarget()
    if (!t) uploadError = 'GitHub nicht eingerichtet (Einstellungen → Konten → Bewertungen: Repo und Token)'
    else { const remote = `logs/${machine}/${name}`; await putFile(t.repo, t.token, remote, tail(text, UPLOAD_MAX)); uploaded = `${t.repo}/${remote}` }
  } catch (e) { uploadError = e instanceof Error ? e.message : String(e) }
  logInfo(`[Log] Upload: ${uploaded ?? `nicht möglich – ${uploadError}`}`)
  return { path, uploaded, uploadError }
}

/** Beim Start: abgeschlossene Sitzungen (nicht die laufende), die noch nicht oben sind, ins Repo laden. Still, wenn nicht eingerichtet. */
export async function uploadPendingLogs(): Promise<void> {
  const t = await catalogTarget().catch(() => null)
  if (!t) return
  const done = new Set<string>(existsSync(uploadedFile()) ? (JSON.parse(await readFile(uploadedFile(), 'utf8')) as string[]) : [])
  const current = currentSessionFile()
  for (const f of (await sessionFiles()).slice(-10)) {
    if (done.has(f) || join(sessionsDir(), f) === current) continue
    try {
      const text = await readFile(join(sessionsDir(), f), 'utf8')
      if (text.trim()) await putFile(t.repo, t.token, `logs/${machine}/sessions/${f}`, tail(text, UPLOAD_MAX))
      done.add(f)
      await writeFile(uploadedFile(), JSON.stringify([...done].slice(-200)), 'utf8')
    } catch (e) { logInfo('[Log] Upload der Sitzung fehlgeschlagen', f, e instanceof Error ? e.message : String(e)); return }
  }
}
