import { rename, rm, writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'

/** Atomar schreiben (tmp + rename). Windows: Virenscanner/Indexer halten Dateien kurz offen → EPERM/EBUSY mit Wiederholung. */
export async function writeFileAtomic(path: string, data: string | Buffer): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.${randomUUID().slice(0, 8)}.tmp`
  await writeFile(tmp, data)
  for (let i = 0; ; i++) {
    try { await rename(tmp, path); return } catch (e) {
      const code = (e as NodeJS.ErrnoException).code
      if (i >= 20 || !(code === 'EPERM' || code === 'EBUSY' || code === 'EACCES')) { await rm(tmp, { force: true }); throw e }
      await new Promise((r) => setTimeout(r, 15 * (i + 1)))
    }
  }
}
