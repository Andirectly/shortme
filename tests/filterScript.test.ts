import { beforeEach, describe, expect, it } from 'vitest'
import { resetGraphFlags, runWithGraphFile } from '../src/main/shortme/render/filterScript'

const OLD = "Unrecognized option '/filter_complex'.\nError splitting the argument list: Option not found"

describe('Filtergraph aus Datei (alte und neue FFmpeg-Versionen)', () => {
  beforeEach(resetGraphFlags)

  it('neues FFmpeg: -/filter_complex, ein Aufruf', async () => {
    const calls: string[][] = []
    await runWithGraphFile(async (_b, a) => { calls.push(a) }, 'new', ['-i', 'in'], 'g.txt', ['out'])
    expect(calls).toEqual([['-i', 'in', '-/filter_complex', 'g.txt', 'out']])
  })

  it('altes FFmpeg (wie im Fehlerbild): weicht auf -filter_complex_script aus und merkt es sich', async () => {
    const calls: string[][] = []
    const run = async (_b: string, a: string[]): Promise<void> => { calls.push(a); if (a.includes('-/filter_complex')) throw new Error(`ffmpeg.exe exited with code 2880417800: ${OLD}`) }
    await runWithGraphFile(run, 'old', ['-i', 'in'], 'g.txt', ['out'])
    expect(calls.map((a) => a[2])).toEqual(['-/filter_complex', '-filter_complex_script'])
    await runWithGraphFile(run, 'old', ['-i', 'in'], 'g.txt', ['out'])
    expect(calls.map((a) => a[2])).toEqual(['-/filter_complex', '-filter_complex_script', '-filter_complex_script'])
  })

  it('andere Fehler werden nicht verschluckt und lösen keinen zweiten Versuch aus', async () => {
    let n = 0
    await expect(runWithGraphFile(async () => { n++; throw new Error('Error opening input file') }, 'x', [], 'g.txt', [])).rejects.toThrow('Error opening input file')
    expect(n).toBe(1)
  })

  it('beide Schreibweisen unbekannt: Fehler kommt an', async () => {
    await expect(runWithGraphFile(async (_b, a) => { throw new Error(a.includes('-/filter_complex') ? OLD : "Unrecognized option 'filter_complex_script'") }, 'y', [], 'g.txt', [])).rejects.toThrow(/filter_complex_script/)
  })
})
