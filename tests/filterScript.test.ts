import { beforeEach, describe, expect, it } from 'vitest'
import { INLINE_MAX, resetGraphFlags, runWithGraphFile } from '../src/main/shortme/render/filterScript'

const OLD = "Unrecognized option '/filter_complex'.\nError splitting the argument list: Option not found"
const LONG = 'x'.repeat(INLINE_MAX + 1)

describe('Filtergraph an FFmpeg (alte und neue Versionen)', () => {
  beforeEach(resetGraphFlags)

  it('normaler Graph: direkt als -filter_complex (jede Version), keine Datei', async () => {
    const calls: string[][] = []
    await runWithGraphFile(async (_b, a) => { calls.push(a) }, 'old', ['-i', 'in'], '[0:v]null[v]', 'g.txt', ['out'])
    expect(calls).toEqual([['-i', 'in', '-filter_complex', '[0:v]null[v]', 'out']])
  })

  it('langer Graph, neues FFmpeg: -/filter_complex, ein Aufruf', async () => {
    const calls: string[][] = []
    await runWithGraphFile(async (_b, a) => { calls.push(a) }, 'new', ['-i', 'in'], LONG, 'g.txt', ['out'])
    expect(calls).toEqual([['-i', 'in', '-/filter_complex', 'g.txt', 'out']])
  })

  it('langer Graph, altes FFmpeg (wie im Fehlerbild): weicht auf -filter_complex_script aus und merkt es sich', async () => {
    const calls: string[][] = []
    const run = async (_b: string, a: string[]): Promise<void> => { calls.push(a); if (a.includes('-/filter_complex')) throw new Error(`ffmpeg.exe exited with code 2880417800: ${OLD}`) }
    await runWithGraphFile(run, 'old', ['-i', 'in'], LONG, 'g.txt', ['out'])
    expect(calls.map((a) => a[2])).toEqual(['-/filter_complex', '-filter_complex_script'])
    await runWithGraphFile(run, 'old', ['-i', 'in'], LONG, 'g.txt', ['out'])
    expect(calls.map((a) => a[2])).toEqual(['-/filter_complex', '-filter_complex_script', '-filter_complex_script'])
  })

  it('auch nur „Option not found“ (ohne Optionsnamen) löst den Ausweichweg aus', async () => {
    const calls: string[][] = []
    await runWithGraphFile(async (_b, a) => { calls.push(a); if (a.includes('-/filter_complex')) throw new Error('Error splitting the argument list: Option not found') }, 'old2', [], LONG, 'g.txt', [])
    expect(calls.map((a) => a[0])).toEqual(['-/filter_complex', '-filter_complex_script'])
  })

  it('andere Fehler werden nicht verschluckt und lösen keinen zweiten Versuch aus', async () => {
    let n = 0
    await expect(runWithGraphFile(async () => { n++; throw new Error('Error opening input file') }, 'x', [], LONG, 'g.txt', [])).rejects.toThrow('Error opening input file')
    expect(n).toBe(1)
  })

  it('beide Schreibweisen unbekannt: Fehler kommt an', async () => {
    await expect(runWithGraphFile(async (_b, a) => { throw new Error(a.includes('-/filter_complex') ? OLD : "Unrecognized option 'filter_complex_script'") }, 'y', [], LONG, 'g.txt', [])).rejects.toThrow(/filter_complex_script/)
  })
})
