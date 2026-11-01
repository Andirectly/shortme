import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { dataRoot } from '../engines/paths'
import { writeFileAtomic } from '../shortme/atomic'
import type { ExportRecord, UploadJob } from '../../shared/upload'

// Exporte und Uploads als einfache JSON-Listen in <Daten>/upload (keine Zugangsdaten, keine Tokens).
const file = (n: string): string => join(dataRoot(), 'upload', `${n}.json`)
async function read<T>(n: string): Promise<T[]> { try { return JSON.parse(await readFile(file(n), 'utf8')) as T[] } catch { return [] } }
let chain: Promise<unknown> = Promise.resolve()
const write = (n: string, v: unknown): Promise<unknown> => (chain = chain.then(() => writeFileAtomic(file(n), JSON.stringify(v, null, 1))))

export const loadExports = (): Promise<ExportRecord[]> => read<ExportRecord>('exports')
export async function addExport(r: Omit<ExportRecord, 'id' | 'createdAt'>): Promise<ExportRecord> {
  const all = await loadExports()
  const rec: ExportRecord = { ...r, id: `${r.hash.slice(0, 8)}-${r.clipId}-${Date.now().toString(36)}`, createdAt: new Date().toISOString() }
  await write('exports', [rec, ...all.filter((x) => x.path !== r.path)].slice(0, 200))
  return rec
}

export const loadJobs = (): Promise<UploadJob[]> => read<UploadJob>('jobs')
export async function saveJob(j: UploadJob): Promise<void> {
  const all = await loadJobs()
  await write('jobs', [j, ...all.filter((x) => x.id !== j.id)].slice(0, 500))
}
