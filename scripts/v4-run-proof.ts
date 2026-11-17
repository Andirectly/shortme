/**
 * Engine 4 – docs/ENGINE_V4_RUN_PROOF.json aus einem echten Lauf erzeugen (nichts wird erfunden: alles stammt aus den Lauf-Dateien, Quelle und Ausgabe
 * werden mit ffprobe und SHA-256 neu gemessen). Ausgabe = erster ausgewählter Clip, dessen Endprüfung genau diese Datei (SHA) bewertet hat.
 *   SHORTME_DATA=<Daten> npx tsx --tsconfig tsconfig.node.json scripts/v4-run-proof.ts <projekt-hash> <runId>
 */
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { runDir } from '../src/main/shortme/clips/engines/state'
import { probeOutput } from '../src/main/shortme/clips/engines/v4/media'

async function main(): Promise<void> {
  const [hash, runId] = process.argv.slice(2)
  const dir = runDir(hash, runId)
  const j = async <T>(n: string): Promise<T> => JSON.parse(await readFile(join(dir, n), 'utf8')) as T
  const manifest = await j<{ runId: string; engineId: string; kind: string; source: { path: string; sha256: string; durationSec: number } }>('manifest.json')
  const sel = await j<{ chosen: Array<{ clipId: string; fromFinalist: string; output: string }>; finalists: Array<{ id: string; sha256: string; output: string }> }>('selection.json')
  const calls = await j<Array<Record<string, unknown>>>('model_calls.json')
  const cov = await j<{ windows: Array<{ lane: string; startSeconds: number; endSeconds: number; status: string; source: string }> }>('coverage.json')
  const verdicts = await j<Array<{ variantId: string; round: number; rendered: { sha256: string }; judgement: { decision: string } | null }>>('verdicts.json')
  const graphs = await j<Array<{ graph: { id: string } }>>('event_graphs.json')
  if (!sel.chosen.length) throw new Error('Lauf hat keinen ausgewählten Clip')
  const ch = sel.chosen[0]
  const fin = sel.finalists.find((f) => f.id === ch.fromFinalist)!
  const src = await probeOutput(manifest.source.path), out = await probeOutput(fin.output)
  if (src.sha256 !== manifest.source.sha256) throw new Error('Quell-SHA weicht vom Manifest ab')
  if (out.sha256 !== fin.sha256) throw new Error('Ausgabe-SHA weicht von der Auswahl ab')
  const proof = {
    runId, engineId: manifest.engineId, runKind: manifest.kind, runManifestAbsolutePath: join(dir, 'manifest.json'),
    sourceSha256: src.sha256, sourceMediaAbsolutePath: manifest.source.path, sourceProbe: { durationSeconds: src.durationSeconds, streams: src.streams },
    outputSha256: out.sha256, outputMediaAbsolutePath: fin.output, outputProbe: { durationSeconds: out.durationSeconds, streams: out.streams },
    modelCalls: calls.map((c) => ({ role: c.role, modelRevision: c.modelRevision, realInputModalities: c.realInputModalities, success: c.success, tracePath: c.tracePath, windowId: c.windowId, inputArtifactSha256: c.inputArtifactSha256, status: c.status })),
    coverage: cov.windows.filter((w) => ['speech', 'audio', 'visual'].includes(w.lane)).map((w) => ({ lane: w.lane, startSeconds: w.startSeconds, endSeconds: w.endSeconds, status: w.status, source: w.source, inspected: w.status === 'inspected' })),
    eventIds: graphs.map((g) => g.graph.id), clipIds: sel.chosen.map((c) => c.clipId), judgementIds: verdicts.filter((v) => v.judgement).map((v) => `${v.variantId}#r${v.round}`),
    timeMapId: `${ch.fromFinalist}:exporter-timemap`, renderedArtifactJudged: calls.some((c) => c.role === 'rendered_output_judge' && c.success === true && c.inputArtifactSha256 === out.sha256),
    generatedAt: new Date().toISOString(), generator: 'scripts/v4-run-proof.ts'
  }
  await writeFile('docs/ENGINE_V4_RUN_PROOF.json', JSON.stringify(proof, null, 2) + '\n', 'utf8')
  console.log(`PASS Run-Proof für ${runId}: Quelle ${src.streams.join('+')} ${src.durationSeconds.toFixed(1)} s, Ausgabe ${out.streams.join('+')} ${out.durationSeconds.toFixed(1)} s, ${calls.length} Modellaufrufe`)
}
main().catch((e) => { console.error('FAIL', e instanceof Error ? e.message : e); process.exit(1) })
