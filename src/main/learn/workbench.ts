import { readdir, rm, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { BrowserWindow } from 'electron'
import { dataRoot } from '../engines/paths'
import { jobs } from '../shortme/ipc'
import { importFile, importUrl } from '../shortme/importer'
import { loadMeta, projectDir, projectFile } from '../shortme/project'
import { runTranscription, loadTranscript } from '../shortme/transcription'
import { loadClips, runAnalysis } from '../shortme/clips/analysis'
import { writeFileAtomic } from '../shortme/atomic'
import { locate, matchByText } from '../../shared/audioMatch'
import { evaluate, STATUS_LABEL, type EvalFile, type WorkItem, type WorkStatus } from '../../shared/workbench'
import type { CreatorFile, CreatorShort } from '../../shared/learnData'
import type { CandTrace } from '../shortme/clips/select'
import { collecting, learnFile, loadLearnSettings, notifyLearnChange, readJson } from './store'
import { cachedFeatures, channelBase, channelShorts, downloadAudio, isChannelUrl, isoDate, shortFeatureFile, shortRatios, shortUrl, tmpAudioBase, ytJson } from './yt'

const itemsFile = (): string => learnFile('workbench.json')
let items: WorkItem[] | null = null
let paused = false
let running = false
let current = ''

async function load(): Promise<WorkItem[]> { return (items ??= await readJson<WorkItem[]>(itemsFile(), [])) }
const broadcast = (): void => { for (const w of BrowserWindow.getAllWindows()) w.webContents.send('learn:workbench', items) }
async function patch(it: WorkItem, p: Partial<WorkItem>): Promise<void> {
  Object.assign(it, p)
  await writeFileAtomic(itemsFile(), JSON.stringify(items))
  broadcast()
}

export const workbenchItems = async (): Promise<WorkItem[]> => [...(await load())]

/** Links hinzufügen: Video → ein Eintrag; Kanal → alle Langvideos (> 8 min). Schon bekannte Videos werden übersprungen. */
export async function addLinks(urls: string[]): Promise<{ added: number; skipped: number }> {
  const all = await load()
  let added = 0, skipped = 0
  const push = async (it: Omit<WorkItem, 'status' | 'shorts' | 'addedAt'>): Promise<void> => {
    if (all.some((x) => x.id === it.id)) { skipped++; return }
    all.push({ ...it, status: 'queued', shorts: 0, addedAt: new Date().toISOString() }); added++
  }
  for (const raw of urls.map((u) => u.trim()).filter(Boolean)) {
    if (isChannelUrl(raw)) {
      const base = channelBase(raw)
      const d = await ytJson(['--flat-playlist', `${base}/videos`])
      for (const e of d.entries as Array<{ id: string; title?: string; duration?: number }>) {
        if ((e.duration ?? 9999) < 480) continue
        await push({ id: e.id, url: `https://www.youtube.com/watch?v=${e.id}`, title: e.title ?? e.id, channel: d.channel ?? d.uploader ?? '', channelUrl: base, date: '', durationSec: e.duration ?? 0 })
      }
    } else {
      const d = await ytJson(['--no-playlist', raw])
      await push({ id: d.id, url: d.webpage_url ?? raw, title: d.title ?? d.id, channel: d.channel ?? d.uploader ?? '', channelUrl: d.channel_url ? channelBase(d.channel_url) : undefined, date: isoDate(d.upload_date), durationSec: d.duration ?? 0 })
    }
  }
  await writeFileAtomic(itemsFile(), JSON.stringify(all))
  broadcast()
  kick()
  return { added, skipped }
}

export async function retry(id: string): Promise<void> { const it = (await load()).find((x) => x.id === id); if (it) { await patch(it, { status: 'queued', error: undefined }); kick() } }
export async function removeItem(id: string): Promise<void> {
  const all = await load()
  const i = all.findIndex((x) => x.id === id)
  if (i < 0 || current === id) return
  all.splice(i, 1)
  await writeFileAtomic(itemsFile(), JSON.stringify(all))
  broadcast()
}
export function setPaused(p: boolean): void { paused = p; if (!p) kick() }
export const isPaused = (): boolean => paused
export const currentId = (): string => current

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
/** Werkbank-Arbeit startet erst, wenn sonst nichts läuft – normale Nutzung hat Vorrang (höchstens eine Werkbank-Stufe wartet vor dem nächsten Job des Nutzers). */
async function idle(): Promise<void> { while (jobs.list().some((j) => j.state === 'queued' || j.state === 'running')) await sleep(5000) }

function runJob(hash: string, title: string, fn: Parameters<typeof jobs.enqueue>[2]): Promise<void> {
  return new Promise((res, rej) => {
    const info = jobs.enqueue(hash, `Werkbank: ${title}`, fn)
    const h = (j: { id: string; state: string; error?: string }): void => {
      if (j.id !== info.id) return
      if (j.state === 'done') { jobs.off('job', h); res() } else if (j.state === 'error' || j.state === 'stopped') { jobs.off('job', h); rej(new Error(j.error ?? 'abgebrochen')) }
    }
    jobs.on('job', h)
  })
}

export function kick(): void {
  if (running || paused) return
  running = true
  void (async () => {
    try {
      for (;;) {
        if (paused || !(await collecting())) break
        const it = (await load()).find((x) => ['queued', 'loading', 'transcribing', 'matched', 'generated'].includes(x.status))
        if (!it) break
        await idle()
        current = it.id
        try { await processItem(it) } catch (e) {
          console.error('Werkbank', it.title, e)
          await patch(it, { status: 'error', error: e instanceof Error ? e.message.slice(0, 300) : String(e) })
        }
        current = ''
      }
    } finally { running = false; current = '' }
  })()
}

const creatorFile = (hash: string): string => projectFile(hash, 'creator.json')
const evalFile = (hash: string): string => projectFile(hash, 'eval.json')

async function processItem(it: WorkItem): Promise<void> {
  // 1) Laden + Shorts zuordnen (erst nur Ton: Langvideos ohne Shorts werden gar nicht komplett geladen)
  let creator = it.hash ? await readJson<CreatorFile | null>(creatorFile(it.hash), null) : null
  if (!creator) {
    await patch(it, { status: 'loading' })
    const d = await ytJson(['--no-playlist', it.url])
    const date = isoDate(d.upload_date) || it.date
    const channelUrl = it.channelUrl ?? (d.channel_url ? channelBase(d.channel_url) : '')
    await patch(it, { date, channel: d.channel ?? it.channel, channelUrl, durationSec: d.duration ?? it.durationSec })
    if (!channelUrl) return patch(it, { status: 'noshorts' })
    const every = await channelShorts(channelUrl)
    const shorts = every.filter((s) => s.date >= date)
    const allRatios = shortRatios(every)
    const audio = await downloadAudio(it.url, tmpAudioBase(`wb-${it.id}`))
    const longF = await cachedFeatures(audio, learnFile(`lf/${it.id}.f32`))
    const out: CreatorShort[] = []
    for (const s of shorts) {
      let sf: Float32Array
      try { sf = await cachedFeatures(await downloadAudio(shortUrl(s.id), tmpAudioBase(`sh-${s.id}`)), shortFeatureFile(s.id)) } catch { continue }
      const moments = locate(sf, longF).filter((m) => m.end - m.start >= 3)
      if (moments.length) out.push({ id: s.id, source: 'creator', title: s.title, url: shortUrl(s.id), views: s.views, likes: s.likes, comments: s.comments, date: s.date, ratio: allRatios[s.id] ?? null, moments })
    }
    await rm(learnFile('tmp'), { recursive: true, force: true })
    await rm(learnFile(`lf/${it.id}.f32`), { force: true })
    if (!out.length) return patch(it, { status: 'noshorts', doneAt: new Date().toISOString() })
    const res = await importUrl(it.url, () => undefined)
    // Heatmap nur bei ≥ 50.000 Aufrufen (sonst zu verrauscht)
    if ((d.view_count ?? 0) < 50_000) await rm(projectFile(res.meta.hash, 'heatmap.json'), { force: true })
    creator = { channel: d.channel ?? it.channel, shorts: out }
    await writeFileAtomic(creatorFile(res.meta.hash), JSON.stringify(creator))
    await patch(it, { hash: res.meta.hash, shorts: out.length })
    notifyLearnChange()
  }
  const hash = it.hash!
  const meta = await loadMeta(hash)
  if (!meta) throw new Error('Projekt fehlt')
  // 2) Transkript
  if (!(await loadTranscript(hash))) {
    await patch(it, { status: 'transcribing' })
    await runJob(hash, it.title, async ({ signal, report }) => { await runTranscription(meta, { diarize: false, signal, onProgress: (p) => report(p.stage, p.fraction, p.message) }) })
  }
  await patch(it, { status: 'matched', shorts: creator.shorts.length })
  // 3) Shortme-Clips: gleiche Anzahl, Standardeinstellungen, ohne die Creator-Shorts zu kennen
  if (!(await loadClips(hash))) await runJob(hash, it.title, async ({ signal, report }) => { await runAnalysis(meta, { wanted: Math.max(1, creator!.shorts.length), signal, onProgress: report }) })
  await patch(it, { status: 'generated' })
  // 4) Auswertung, dann Speicher freigeben
  await evaluateProject(hash)
  if ((await loadLearnSettings()).deleteVideos) await dropVideo(hash)
  await patch(it, { status: 'evaluated', doneAt: new Date().toISOString() })
  notifyLearnChange()
}

/** Auswertung Creator-/Referenz-Momente ↔ Shortme-Clips (eval.json im Projekt). */
export async function evaluateProject(hash: string): Promise<EvalFile | null> {
  const creator = await readJson<CreatorFile | null>(creatorFile(hash), null)
  const clips = await loadClips(hash)
  if (!creator || !clips) return null
  const trace = await readJson<CandTrace[]>(projectFile(hash, 'candidates.json'), [])
  const prev = await readJson<EvalFile | null>(evalFile(hash), null)
  const ev: EvalFile = { at: prev?.at ?? new Date().toISOString(), hash, wanted: clips.clips.length, moments: evaluate(creator.shorts, clips.clips, trace) }
  await writeFileAtomic(evalFile(hash), JSON.stringify(ev))
  return ev
}

const downloads = (): string => resolve(dataRoot(), 'downloads').toLowerCase()
/** Videodatei löschen; Ton, Transkript, Schlüsselbilder und Datensatz bleiben. Blindtest/Editor laden sie bei Bedarf neu (ensureSource). */
async function dropVideo(hash: string): Promise<void> {
  const meta = await loadMeta(hash)
  if (meta && resolve(meta.sourcePath).toLowerCase().startsWith(downloads())) await rm(meta.sourcePath, { force: true })
}

export async function ensureSource(hash: string): Promise<NonNullable<Awaited<ReturnType<typeof loadMeta>>>> {
  const meta = await loadMeta(hash)
  if (!meta) throw new Error('Projekt fehlt')
  if (!existsSync(meta.sourcePath)) { if (!meta.sourceUrl) throw new Error('Quellvideo fehlt'); await importUrl(meta.sourceUrl, () => undefined) }
  return meta
}

/** Referenz-Clip (z. B. von Opus) einem Projekt zuordnen: Tonabgleich, sonst Rückfall über das Transkript des Clips. */
export async function addReference(hash: string, file: string): Promise<{ moments: number }> {
  const meta = await loadMeta(hash)
  if (!meta) throw new Error('Projekt fehlt')
  const longF = await cachedFeatures(projectFile(hash, 'audio.wav'), projectFile(hash, 'features8k.f32'))
  const id = createHash('sha1').update(file).digest('hex').slice(0, 10)
  const sf = await cachedFeatures(file, learnFile(`sf/ref-${id}.f32`))
  let moments = locate(sf, longF).filter((m) => m.end - m.start >= 3)
  if (!moments.length) {
    const tr = await loadTranscript(hash)
    if (tr) {
      const imp = await importFile(file)
      const st = await runTranscription(imp.meta, { diarize: false })
      moments = matchByText(st.words.map((w) => w.w), tr.words).filter((m) => m.end - m.start >= 3)
    }
  }
  if (!moments.length) return { moments: 0 }
  const cf = await readJson<CreatorFile>(creatorFile(hash), { channel: '', shorts: [] })
  cf.shorts = [...cf.shorts.filter((s) => s.id !== `ref-${id}`), { id: `ref-${id}`, source: 'reference', title: basename(file), views: 0, likes: 0, comments: 0, date: '', ratio: null, moments }]
  await writeFileAtomic(creatorFile(hash), JSON.stringify(cf))
  await evaluateProject(hash)
  notifyLearnChange()
  return { moments: moments.length }
}

export async function loadEvals(): Promise<EvalFile[]> {
  const out: EvalFile[] = []
  for (const it of await load()) if (it.hash) { const e = await readJson<EvalFile | null>(evalFile(it.hash), null); if (e) out.push(e) }
  return out
}

async function dirBytes(p: string): Promise<number> {
  let n = 0
  for (const e of await readdir(p, { withFileTypes: true }).catch(() => [])) {
    const f = join(p, e.name)
    n += e.isDirectory() ? await dirBytes(f) : (await stat(f).catch(() => null))?.size ?? 0
  }
  return n
}
/** Belegter Speicher der Werkbank (Projekte, Videos, Abgleich-Daten). */
export async function storageBytes(): Promise<number> {
  let n = await dirBytes(learnFile('sf'))
  for (const it of await load()) if (it.hash) {
    n += await dirBytes(projectDir(it.hash))
    const meta = await loadMeta(it.hash)
    if (meta && existsSync(meta.sourcePath) && resolve(meta.sourcePath).toLowerCase().startsWith(downloads())) n += (await stat(meta.sourcePath)).size
  }
  return n
}

/** Beim Start: unterbrochene Einträge fortsetzen (verzögert). */
export function resumeWorkbench(): void { setTimeout(kick, 90_000).unref() }
export { STATUS_LABEL }
export type { WorkStatus }

export async function resetWorkbench(): Promise<void> {
  if (current) throw new Error('Die Werkbank arbeitet gerade – erst pausieren und warten.')
  items = []
  await writeFileAtomic(itemsFile(), '[]')
  broadcast()
}
