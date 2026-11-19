// Engine Mac 2 – lokale MLX-Modelle als OpenAI-kompatible Server (mlx_vlm.server 0.8.0, Python-Umgebung py312-macav).
//   Qwen3.5-9B (4-bit): Sprachsuche, Schnittplanung, Titel, Inhaltsprüfung (Text)
//   LFM3-Omni-2B (8-bit): Beobachtung von Bildern + separat zugeführtem Ton (vor und nach dem Rendern)
// Gleiche Schnittstelle wie llama-server: /v1/chat/completions mit response_format json_schema (llguidance erzwingt das Schema, Enums für erlaubte IDs)
// und chat_template_kwargs.enable_thinking=false. Jeder Server ist ein Resident im gemeinsamen VramSequencer: nie zwei große Modelle gleichzeitig,
// innerhalb einer Phase bleibt das Modell geladen. Zeitlimit = Prozess beenden (Arbeit stoppt wirklich), danach lädt die nächste Phase neu.
import { spawn, type ChildProcess } from 'node:child_process'
import { vram } from '../../../../engines'
import { assetDir } from '../../../../engines/paths'
import { freePort, killTree, track } from '../../../../engines/sidecars'
import { avPythonExe } from '../v3/runtime'

export const MAC_QWEN = { id: 'qwen3.5-9b-mlx', revision: '8b2b98c00a6b4d291155e4890773ca8f769aee53', repo: 'mlx-community/Qwen3.5-9B-4bit', license: 'Apache-2.0' } as const
export const MAC_LFM = { id: 'lfm3-omni-2b', revision: '5901d16cbc5f1774243db907cd407f825591f743', repo: 'LiquidAI/LFM3-Omni-2B-MLX-8bit', license: 'LFM Open License v1.0' } as const
export const MLX_RUNTIME = 'mlx-vlm 0.8.0 (mlx 0.32.4)'
export const MODEL_LOAD_TIMEOUT_MS = 120_000

export interface MlxSession { url: string; model: string; modelId: string; revision: string; loadMs: number; /** Prozess hart beenden (Zeitlimit): Arbeit stoppt, nächste Phase lädt neu. */ kill: () => Promise<void> }

function mlxServer(name: string, spec: { id: string; revision: string }): <T>(fn: (s: MlxSession) => Promise<T>) => Promise<T> {
  let child: ChildProcess | null = null
  let session: MlxSession | null = null
  const stop = async (): Promise<void> => {
    const c = child
    child = null
    session = null
    if (c?.pid) await killTree(c.pid)
  }
  vram.register({
    name,
    load: async () => {
      const t0 = Date.now()
      const port = await freePort()
      const model = assetDir(spec.id)
      const c = spawn(avPythonExe(), ['-I', '-m', 'mlx_vlm.server', '--model', model, '--host', '127.0.0.1', '--port', String(port), '--max-tokens', '2048'], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1', HF_HUB_DISABLE_TELEMETRY: '1', APC_ENABLED: '1', APC_DISK_ENABLED: '0' } })
      child = c
      let tail = ''
      const keep = (d: Buffer): void => { tail = (tail + d.toString()).slice(-3000) }
      c.stdout?.on('data', keep); c.stderr?.on('data', keep)
      await track(c, `${name}-mlx-server`, avPythonExe())
      const url = `http://127.0.0.1:${port}`
      // bereit = Modell geladen UND eine Mini-Anfrage beantwortet (der Server lädt --model im Hintergrund)
      for (;;) {
        if (c.exitCode !== null) { await stop(); throw new Error(`${spec.id}: MLX-Server beendet (Code ${c.exitCode}): ${tail.slice(-400)}`) }
        if (Date.now() - t0 > MODEL_LOAD_TIMEOUT_MS) { await stop(); throw new Error(`${spec.id}: Modell lädt nicht (Zeitüberschreitung ${MODEL_LOAD_TIMEOUT_MS / 1000} s)`) }
        try {
          const r = await fetch(`${url}/v1/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, messages: [{ role: 'user', content: 'ok' }], max_tokens: 1, chat_template_kwargs: { enable_thinking: false } }), signal: AbortSignal.timeout(60_000) })
          if (r.ok) break
        } catch { /* noch nicht bereit */ }
        await new Promise((r) => setTimeout(r, 750))
      }
      // kill: nur den Prozess beenden (releaseAll innerhalb von vram.use würde auf sich selbst warten); die nächste Phase lädt neu (siehe unten)
      session = { url, model, modelId: spec.id, revision: spec.revision, loadMs: Date.now() - t0, kill: stop }
    },
    unload: stop
  })
  return async (fn) => {
    // nach einem Zeitlimit (Prozess beendet) gilt der Resident im Sequencer noch als geladen → erst freigeben, dann lädt use() neu
    if (!session && vram.loaded === name) await vram.releaseAll()
    return vram.use(name, () => { if (!session) throw new Error(`${spec.id}: Modellprozess wurde beendet`); return fn(session) })
  }
}

/** Qwen3.5-Phase (Text). */
export const withQwen = mlxServer('mac-qwen', MAC_QWEN)
/** LFM3-Omni-Phase (Bild + Ton). */
export const withLfm = mlxServer('mac-lfm', MAC_LFM)

export type ContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } } | { type: 'input_audio'; input_audio: { data: string; format: 'wav' } }

/**
 * Eine Anfrage mit erzwungenem JSON-Schema. Zeitlimit beendet den Server-Prozess (keine weiterrechnende GPU). Keine versteckten Wiederholungen:
 * jede Wiederholung entscheidet der Aufrufer über sein Anfragebudget.
 */
export async function mlxJson<T = unknown>(s: MlxSession, o: { system?: string; content: string | ContentPart[]; schema: object; maxTokens: number; timeoutMs: number; temperature?: number; signal?: AbortSignal }): Promise<{ value: T; raw: string; ms: number; usage?: { prompt_tokens?: number; completion_tokens?: number } }> {
  const t0 = Date.now()
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(new Error('timeout')), o.timeoutMs)
  const onAbort = (): void => ctl.abort(o.signal?.reason)
  o.signal?.addEventListener('abort', onAbort, { once: true })
  try {
    const res = await fetch(`${s.url}/v1/chat/completions`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, signal: ctl.signal,
      body: JSON.stringify({
        model: s.model,
        messages: [...(o.system ? [{ role: 'system', content: o.system }] : []), { role: 'user', content: o.content }],
        temperature: o.temperature ?? 0, max_tokens: o.maxTokens,
        chat_template_kwargs: { enable_thinking: false },
        response_format: { type: 'json_schema', json_schema: { name: 'answer', strict: true, schema: o.schema } }
      })
    })
    const body = await res.text()
    if (!res.ok) throw new Error(`${s.modelId}: HTTP ${res.status} ${body.slice(0, 200)}`)
    const j = JSON.parse(body) as { choices: Array<{ message: { content: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } }
    const raw = j.choices?.[0]?.message?.content ?? ''
    return { value: JSON.parse(raw.replace(/^[\s\S]*?(\{)/, '$1')) as T, raw, ms: Date.now() - t0, usage: j.usage }
  } catch (e) {
    // Abbruch durch den Nutzer: Modellprozess ebenfalls beenden (sonst rechnet die GPU die verworfene Anfrage zu Ende)
    if (o.signal?.aborted) { await s.kill(); throw e }
    if (ctl.signal.aborted) {
      // Zeitlimit: Server hart beenden, sonst rechnet die GPU weiter
      await s.kill()
      throw new Error(`${s.modelId}: Zeitlimit ${Math.round(o.timeoutMs / 1000)} s überschritten – Modellprozess beendet`, { cause: e })
    }
    throw e
  } finally {
    clearTimeout(timer)
    o.signal?.removeEventListener('abort', onAbort)
  }
}
