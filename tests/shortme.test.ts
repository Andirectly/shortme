import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { preflight } from '../src/main/shortme/preflight'
import { JobQueue } from '../src/main/shortme/jobs'
import { writeFileAtomic } from '../src/main/shortme/atomic'
import { fileHash } from '../src/main/shortme/project'
import { buildTranscript } from '../src/main/shortme/transcription'
import { assignSpeakers } from '../src/main/engines/asr/protocol'

let dir = ''
beforeAll(async () => { dir = await mkdtemp(join(tmpdir(), 'shortme-m3-')) })
afterAll(async () => { await rm(dir, { recursive: true, force: true }) })

const GB = 1024 ** 3

describe('Vorabprüfung', () => {
  it('akzeptiert ein normales Video bei genug Speicher', () => {
    const r = preflight({ durationSec: 3600, sizeBytes: 2 * GB, hasAudio: true }, 200)
    expect(r.ok).toBe(true)
    expect(r.peakGb).toBeGreaterThan(2.2)
    expect(r.peakGb).toBeLessThan(2.4)
  })
  it('lehnt fehlende Audiospur ab', () => {
    const r = preflight({ durationSec: 100, sizeBytes: GB, hasAudio: false }, 200)
    expect(r.ok).toBe(false)
    expect(r.errors[0]).toMatch(/Audiospur/)
  })
  it('hält Reserve von 1 GB nach dem Spitzenbedarf ein', () => {
    const need = preflight({ durationSec: 600, sizeBytes: GB, hasAudio: true }, 1000).peakGb
    expect(preflight({ durationSec: 600, sizeBytes: GB, hasAudio: true }, need + 0.9).ok).toBe(false)
    expect(preflight({ durationSec: 600, sizeBytes: GB, hasAudio: true }, need + 1.1).ok).toBe(true)
  })
  it('warnt bei sehr kurzen und sehr langen Videos', () => {
    expect(preflight({ durationSec: 30, sizeBytes: 1e7, hasAudio: true }, 100).warnings).toHaveLength(1)
    expect(preflight({ durationSec: 5 * 3600, sizeBytes: 1e9, hasAudio: true }, 500).warnings).toHaveLength(1)
  })
})

describe('Datei-Hash', () => {
  it('ist stabil, unabhängig vom Pfad, und ändert sich bei Inhalt', async () => {
    const a = join(dir, 'a.bin')
    const b = join(dir, 'b.bin')
    const big = Buffer.alloc(14 * 1024 * 1024, 7)
    await writeFile(a, big)
    await writeFile(b, big)
    expect(await fileHash(a)).toBe(await fileHash(b))
    big[big.length - 10] = 9
    await writeFile(b, big)
    expect(await fileHash(a)).not.toBe(await fileHash(b))
  })
})

describe('writeFileAtomic', () => {
  it('überschreibt ohne halbe Dateien und mit parallelen Schreibern', async () => {
    const f = join(dir, 'atomic.json')
    await Promise.all(Array.from({ length: 25 }, (_, i) => writeFileAtomic(f, JSON.stringify({ i, pad: 'x'.repeat(5000) }))))
    const parsed = JSON.parse(await readFile(f, 'utf8'))
    expect(parsed.pad.length).toBe(5000)
  })
})

describe('Transkript-Aufbau', () => {
  const seg = (start: number, words: string[]) => ({ start, end: start + words.length * 0.4, text: words.join(' '), words: words.map((w, i) => ({ w, start: start + i * 0.4, end: start + i * 0.4 + 0.35 })) })
  it('sortiert, indiziert und behält leere VAD-Intervalle', () => {
    const t = buildTranscript({ hash: 'h', durationSec: 20 }, [seg(5, ['drei', 'vier']), seg(0, ['eins', 'zwei']), { start: 10, end: 11, text: '', words: [] }], null)
    expect(t.words.map((w) => w.w)).toEqual(['eins', 'zwei', 'drei', 'vier'])
    expect(t.segments[1]).toMatchObject({ first: 2, last: 3 })
    expect(t.speech).toEqual([[0, 0.8], [5, 5.8], [10, 11]])
    expect(t.diarized).toBe(false)
  })
  it('weist Sprecher nach größter Überlappung zu', () => {
    const t = buildTranscript({ hash: 'h', durationSec: 20 }, [seg(0, ['a', 'b', 'c', 'd'])], [{ start: 0, end: 0.9, speaker: 1 }, { start: 0.9, end: 3, speaker: 0 }])
    expect(t.words.map((w) => w.speaker)).toEqual([1, 1, 0, 0])
    expect(t.speakers).toBe(2)
  })
  it('nutzt den nächsten Sprecher, wenn ein Wort in keinem Abschnitt liegt', () => {
    const words = [{ w: 'x', start: 10, end: 10.3 }]
    assignSpeakers(words, [{ start: 0, end: 1, speaker: 3 }, { start: 12, end: 14, speaker: 5 }])
    expect(words[0]).toMatchObject({ speaker: 5 })
  })
})

describe('JobQueue', () => {
  const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

  it('führt Jobs nacheinander aus und meldet Fortschritt', async () => {
    const q = new JobQueue()
    const order: string[] = []
    const mk = (n: string) => async ({ report }: { report: (s: string, p: number, m: string) => void }) => { order.push(`start-${n}`); report('x', 0.5, 'halb'); await wait(20); order.push(`end-${n}`) }
    q.enqueue('h1', 'A', mk('a'))
    const b = q.enqueue('h2', 'B', mk('b'))
    await wait(150)
    expect(order).toEqual(['start-a', 'end-a', 'start-b', 'end-b'])
    expect(q.get(b.id)?.state).toBe('done')
  })

  it('pausiert, setzt fort und stoppt (Checkpoint bleibt Sache des Jobs)', async () => {
    const q = new JobQueue()
    let runs = 0
    const j = q.enqueue('h', 'P', async ({ signal }) => {
      runs++
      await new Promise<void>((resolve, reject) => { const t = setTimeout(resolve, runs === 1 ? 5000 : 10); signal.addEventListener('abort', () => { clearTimeout(t); reject(new Error('abort')) }) })
    })
    await wait(30)
    q.pause(j.id)
    await wait(30)
    expect(q.get(j.id)?.state).toBe('paused')
    q.resume(j.id)
    await wait(80)
    expect(q.get(j.id)?.state).toBe('done')
    expect(runs).toBe(2)

    const s = q.enqueue('h', 'S', async ({ signal }) => { await new Promise<void>((_, reject) => signal.addEventListener('abort', () => reject(new Error('x')))) })
    await wait(30)
    q.stop(s.id)
    await wait(30)
    expect(q.get(s.id)?.state).toBe('stopped')
  })

  it('verwirft: bricht ab, ruft Aufräumen auf, entfernt den Job', async () => {
    const q = new JobQueue()
    let cleaned = false
    const j = q.enqueue('h', 'D', async ({ signal }) => { await new Promise<void>((_, reject) => signal.addEventListener('abort', () => reject(new Error('x')))) }, async () => { cleaned = true })
    await wait(30)
    await q.discard(j.id)
    expect(cleaned).toBe(true)
    expect(q.get(j.id)).toBeUndefined()
  })

  it('meldet Fehler eines Jobs, ohne die Warteschlange zu blockieren', async () => {
    const q = new JobQueue()
    const bad = q.enqueue('h', 'bad', async () => { throw new Error('kaputt') })
    const ok = q.enqueue('h', 'ok', async () => undefined)
    await wait(60)
    expect(q.get(bad.id)).toMatchObject({ state: 'error', error: 'kaputt' })
    expect(q.get(ok.id)?.state).toBe('done')
  })
})
