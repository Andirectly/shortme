import { existsSync, mkdtempSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FFMPEG_PATH } from '../src/main/pipeline/ffmpeg'
import { pcm8k } from '../src/main/learn/yt'
import { features, locate } from '../src/shared/audioMatch'

const SRC = 'test-videos/podcast-2p.mp4'
// Echtes Material: Ausschnitt aus dem Podcast, leiser und hochpassgefiltert (wie ein neu kodierter Short)
describe.skipIf(!existsSync(SRC))('Tonabgleich auf echtem Podcast', () => {
  it('findet Ausschnitte auf 1 s genau, fremder Ton findet nichts', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'am-'))
    const cut = (ss: number, t: number, out: string): string => {
      const f = join(dir, out)
      spawnSync(FFMPEG_PATH, ['-v', 'error', '-y', '-ss', String(ss), '-t', String(t), '-i', SRC, '-vn', '-ac', '1', '-ar', '44100', '-af', 'volume=0.5,highpass=f=200', f])
      return f
    }
    const long = features(await pcm8k(SRC))
    const a = locate(features(await pcm8k(cut(200, 25, 'a.m4a'))), long)
    expect(a).toHaveLength(1)
    expect(a[0].start).toBeCloseTo(200, 0); expect(a[0].end).toBeCloseTo(225, 0)
    const b = locate(features(await pcm8k(cut(400, 12, 'b.m4a'))), long)
    expect(b[0].start).toBeCloseTo(400, 0)
    if (existsSync('test-videos/solo.mp4')) expect(locate(features(await pcm8k('test-videos/solo.mp4')).slice(0, 8 * 10 * 30), long)).toEqual([])
  }, 120000)
})
