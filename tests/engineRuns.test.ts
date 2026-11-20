import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import type { ShortmeClip } from '../src/shared/shortme'
import { LEGACY_RUN_ID, enginesFor, newRunId, v2ClipId, type RunInfo } from '../src/shared/engine'

const HASH = 'abc123'
let data = ''
const clip = (id: string, over: Partial<ShortmeClip> = {}): ShortmeClip => ({ id, start: 10, end: 40, firstWord: 0, lastWord: 5, score: 80, criteria: { hook: 1, payoff: 1, quotable: 1, standalone: 1, density: 1 }, title: id, hookText: 'h', reason: '', tags: [], source: 'llm', snap: [], extended: 0, ...over })
const write = (rel: string, json: unknown): void => { const p = join(data, 'projects', HASH, rel); mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, JSON.stringify(json)) }
const read = (rel: string): string => readFileSync(join(data, 'projects', HASH, rel), 'utf8')
const meta = { hash: HASH, title: 'T', sourcePath: 'x.mp4', durationSec: 600, width: 1920, height: 1080, fps: 30, sizeBytes: 1, hasAudio: true, created: '', stages: {} }

beforeEach(() => {
  data = mkdtempSync(join(tmpdir(), 'sm-runs-'))
  process.env.SHORTME_DATA = data
  write('project.json', meta)
})

const runInfo = (runId: string, over: Partial<RunInfo> = {}): RunInfo => ({ runId, engineId: 'multimodal-v2', engineVersion: '2.0.0', schema: 1, createdAt: '', status: 'done', fingerprint: 'fp1', options: { query: '', contentType: null, frame: 'smart', wanted: null, minSec: 15, maxSec: 75 }, models: {}, modalities: {}, ...over })

describe('Läufe: Legacy bleibt unverändert, V2 liegt im eigenen Ordner', () => {
  it('altes Projekt (nur clips.json) wird als Legacy gelesen, ohne Datei zu verändern', async () => {
    write('clips.json', { version: 1, hash: HASH, query: '', createdAt: '', mode: 'llm', thumbs: {}, clips: [clip('clip-100')] })
    const before = read('clips.json')
    const { loadClips, findClip } = await import('../src/main/shortme/clips/analysis')
    const f = await loadClips(HASH)
    expect(f?.clips.map((c) => c.id)).toEqual(['clip-100'])
    expect((await findClip(HASH, 'clip-100'))?.runId).toBe(LEGACY_RUN_ID)
    expect(read('clips.json')).toBe(before)
    expect(existsSync(join(data, 'projects', HASH, 'analysis', 'state.json'))).toBe(false) // keine Startmigration
  })

  it('V1 → V2 → V1: Löschen im V2-Lauf berührt das bisherige Ergebnis nicht; Clip-IDs kollidieren nie', async () => {
    write('clips.json', { version: 1, hash: HASH, query: '', createdAt: '', mode: 'llm', thumbs: {}, clips: [clip('clip-100'), clip('clip-200')] })
    const { loadClips, saveClips, findClip } = await import('../src/main/shortme/clips/analysis')
    const { registerRun, showRun, loadState } = await import('../src/main/shortme/clips/engines/state')
    const { clipsPathFor } = await import('../src/main/shortme/clips/engines/state')
    const rid = newRunId()
    await registerRun(HASH, runInfo(rid))
    const v2a = clip(v2ClipId(rid, 1), { source: 'v2', engine: 'multimodal-v2', runId: rid })
    const v2b = clip(v2ClipId(rid, 2), { source: 'v2', engine: 'multimodal-v2', runId: rid })
    mkdirSync(join(clipsPathFor(HASH, rid), '..'), { recursive: true })
    writeFileSync(clipsPathFor(HASH, rid), JSON.stringify({ version: 1, hash: HASH, query: '', createdAt: '', mode: 'v2', engine: 'multimodal-v2', runId: rid, thumbs: {}, clips: [v2a, v2b] }))
    await showRun(HASH, rid)
    expect((await loadClips(HASH))?.clips).toHaveLength(2) // angezeigter Lauf = V2
    expect((await loadClips(HASH))?.clips[0].id).toContain(rid)
    // Clip aus V2 löschen (wie corrections.deleteClip: laden aus dem Lauf, in denselben Lauf zurückschreiben)
    const found = await findClip(HASH, v2a.id)
    expect(found?.runId).toBe(rid)
    const file = (await loadClips(HASH, found!.runId))!
    await saveClips(HASH, { ...file, clips: file.clips.filter((c) => c.id !== v2a.id) })
    expect((await loadClips(HASH, rid))?.clips).toHaveLength(1)
    expect((await loadClips(HASH, LEGACY_RUN_ID))?.clips.map((c) => c.id)).toEqual(['clip-100', 'clip-200']) // unberührt
    // zurück auf V1
    await showRun(HASH, LEGACY_RUN_ID)
    expect((await loadClips(HASH))?.clips.map((c) => c.id)).toEqual(['clip-100', 'clip-200'])
    // Editor/Export finden Clips beider Läufe unabhängig vom angezeigten Lauf
    expect((await findClip(HASH, v2b.id))?.runId).toBe(rid)
    expect((await loadState(HASH)).shown).toBe(LEGACY_RUN_ID)
    expect(v2ClipId(rid, 1)).not.toBe('clip-100')
  })

  it('unsichere Lauf-IDs erreichen nie das Dateisystem', async () => {
    const { runFile } = await import('../src/main/shortme/clips/engines/state')
    expect(() => runFile(HASH, '../../evil', 'clips.json')).toThrow()
    expect(() => runFile(HASH, 'a/b', 'clips.json')).toThrow()
  })

  it('unterbrochener Lauf („running“ ohne Job) wird als gestoppt markiert, nie als fertig', async () => {
    const { registerRun, stopStaleRuns } = await import('../src/main/shortme/clips/engines/state')
    await registerRun(HASH, runInfo('v2-aaa-bbbbb', { status: 'running' }))
    const s = await stopStaleRuns(HASH)
    expect(s.runs.find((r) => r.runId === 'v2-aaa-bbbbb')?.status).toBe('stopped')
  })
})

describe('Umschalter-Entscheidung im Main-Prozess', () => {
  const HAS_V2 = enginesFor(process.platform).includes('multimodal-v2')
  const LOCAL = HAS_V2 ? 'multimodal-v2' : enginesFor(process.platform)[0] // Windows: Engine 1–4, Mac: nur Engine Mac (Grenze im Hauptprozess)
  const deps = (over: Partial<import('../src/main/shortme/clips/engines/control').SwitchDeps> = {}): import('../src/main/shortme/clips/engines/control').SwitchDeps & { started: number } => {
    const d = { started: 0, hasActiveJob: () => false, missingModels: async () => [], revisions: () => ['r1'], start: () => { d.started++; return 'job1' }, ...over }
    return d as never
  }
  it('Modelle fehlen: Hinweis statt Start, kein stiller Wechsel auf Legacy', async () => {
    const { switchEngine } = await import('../src/main/shortme/clips/engines/control')
    const { loadState } = await import('../src/main/shortme/clips/engines/state')
    const d = deps({ missingModels: async () => [{ id: 'qwen3-vl-4b', name: 'Qwen3-VL', sizeBytes: 1 }] })
    const { enginesFor } = await import('../src/shared/engine')
    const e = enginesFor(process.platform).at(-1)! // Mac: nur Engine Mac wählbar
    const r = await switchEngine({ hash: HASH, engine: e }, d)
    expect(r.kind).toBe('needs-models')
    expect(d.started).toBe(0)
    expect((await loadState(HASH)).selected).toBe(e) // Wahl bleibt, Anzeige bleibt beim bisherigen Ergebnis
  })
  it('läuft ein Job oder ein zweiter Klick kommt gleichzeitig: genau ein Start', async () => {
    const { switchEngine } = await import('../src/main/shortme/clips/engines/control')
    write('transcript.json', { version: 1, hash: HASH, model: 'parakeet-v3', durationSec: 600, words: [], segments: [], speech: [], diarized: false, speakers: 1 })
    const d = deps()
    const [a, b] = await Promise.all([switchEngine({ hash: HASH, engine: LOCAL }, d), switchEngine({ hash: HASH, engine: LOCAL }, d)])
    expect([a.kind, b.kind].sort()).toEqual(['busy', 'started'])
    expect(d.started).toBe(1)
    const busy = await switchEngine({ hash: HASH, engine: LOCAL }, deps({ hasActiveJob: () => true }))
    expect(busy.kind).toBe('busy')
  })
  it.skipIf(!HAS_V2)('vorhandenes V2-Ergebnis wird beim Wechsel angezeigt, auch bei geänderten Optionen; ohne Ergebnis startet ein Lauf', async () => {
    const { switchEngine, analysisFingerprint } = await import('../src/main/shortme/clips/engines/control')
    const { registerRun, clipsPathFor } = await import('../src/main/shortme/clips/engines/state')
    const { loadTranscript } = await import('../src/main/shortme/transcription')
    const { loadProfile } = await import('../src/main/shortme/profiles')
    const { TRANSCRIPT_VERSION } = await import('../src/main/shortme/transcription')
    write('transcript.json', { version: TRANSCRIPT_VERSION, hash: HASH, model: 'parakeet-v3', durationSec: 600, words: [], segments: [], speech: [], diarized: false, speakers: 1 })
    const t = (await loadTranscript(HASH))!
    const frame = (await loadProfile(undefined)).frame
    const fp = analysisFingerprint({ hash: HASH, engine: 'multimodal-v2', transcriptVersion: t.version, wordCount: 0, asrModel: t.model, contentType: null, frame, wanted: null, revisions: ['r1'] })
    const rid = newRunId()
    await registerRun(HASH, runInfo(rid, { fingerprint: fp }))
    mkdirSync(join(clipsPathFor(HASH, rid), '..'), { recursive: true })
    writeFileSync(clipsPathFor(HASH, rid), JSON.stringify({ version: 1, hash: HASH, clips: [] }))
    const d = deps()
    const same = await switchEngine({ hash: HASH, engine: 'multimodal-v2' }, d)
    expect(same.kind).toBe('shown'); expect(d.started).toBe(0)
    const other = await switchEngine({ hash: HASH, engine: 'multimodal-v2', query: 'Rap', wanted: 3 }, d)
    expect(other.kind).toBe('shown'); expect(d.started).toBe(0)
  })
})
