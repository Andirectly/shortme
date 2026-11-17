// Engine 4 – Spuren jedes Modellaufrufs (Spezifikation 10, „Central metadata“): Datei je Aufruf unter <Lauf>/traces/, Liste für Manifest und Run-Proof.
import { appendFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { writeFileAtomic } from '../../../atomic'

export type Modality = 'video' | 'audio' | 'speech' | 'text' | 'metadata'
export interface ModelCall {
  callId: string; role: string; modelRevision: string; promptRevision?: string; requestId: string
  realInputModalities: Modality[]; actualMediaWindowIds: string[]; windowId?: string; verificationGroupId?: string; inputArtifactSha256?: string
  success: boolean; validatedOutput: boolean; wallClockMs: number; status: string; tracePath: string; error?: string
}

export class Tracer {
  readonly calls: ModelCall[] = []
  private n = 0
  constructor(readonly runDir: string, readonly runId: string, readonly sourceSha256: string) {}

  /** Aufruf protokollieren: Eingaben (Pfade/Zeiten, keine Medien), Rohantwort (gekürzt), geprüfte Ausgabe, Fehler. */
  async record(c: Omit<ModelCall, 'callId' | 'tracePath' | 'requestId'> & { requestId?: string; input: unknown; rawOutput?: string; output?: unknown }): Promise<ModelCall> {
    const callId = `c${String(++this.n).padStart(4, '0')}`
    const tracePath = join('traces', `${callId}-${c.role}.json`)
    const { input, rawOutput, output, ...meta } = c
    const call: ModelCall = { ...meta, callId, tracePath, requestId: c.requestId ?? randomUUID() }
    await mkdir(join(this.runDir, 'traces'), { recursive: true })
    await writeFileAtomic(join(this.runDir, tracePath), JSON.stringify({ runId: this.runId, sourceSha256: this.sourceSha256, ...call, input, rawOutput: rawOutput?.slice(0, 8000), output }, null, 1))
    this.calls.push(call)
    return call
  }

  async log(file: string, obj: unknown): Promise<void> {
    await mkdir(this.runDir, { recursive: true })
    await appendFile(join(this.runDir, file), JSON.stringify(obj) + '\n', 'utf8')
  }
}
