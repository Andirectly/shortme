// Multimodaler Aufruf an llama-server (OpenAI-kompatibel): Bilder als `image_url`, Audio als `input_audio`, Antwort als JSON gegen ein Schema.
// Die Modelle bekommen Bilder/Ton wirklich übergeben; der Text trägt nur Frage und Kennungen (Frame-IDs), keine Bildbeschreibung aus zweiter Hand.
import { readFile } from 'node:fs/promises'

export type MmPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
  | { type: 'input_audio'; input_audio: { data: string; format: 'wav' } }

export const textPart = (text: string): MmPart => ({ type: 'text', text })
export const imagePart = (jpeg: Buffer): MmPart => ({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${jpeg.toString('base64')}` } })
export const audioPart = (wav: Buffer): MmPart => ({ type: 'input_audio', input_audio: { data: wav.toString('base64'), format: 'wav' } })
export const imageFilePart = async (path: string): Promise<MmPart> => imagePart(await readFile(path))

export interface MmOptions<T> {
  schema: object
  validate: (x: unknown) => T
  maxTokens?: number
  temperature?: number
  signal?: AbortSignal
  /** Modelle ohne Systemprompt (Voxtral): Anweisung steht dann im Nutzerteil. */
  noSystem?: boolean
}

/** Ein Aufruf mit Medien; ungültige Antworten werden einmal wiederholt (strengere Erinnerung), danach verständlicher Fehler. */
export async function chatMm<T>(baseUrl: string, system: string, parts: MmPart[], opts: MmOptions<T>): Promise<T> {
  let lastError = ''
  for (let attempt = 0; attempt < 2; attempt++) {
    opts.signal?.throwIfAborted()
    const reminder = lastError ? [textPart(`(Die vorherige Antwort war ungültig: ${lastError}. Antworte exakt im vorgegebenen JSON-Schema.)`)] : []
    const messages = opts.noSystem
      ? [{ role: 'user', content: [textPart(system), ...parts, ...reminder] }]
      : [{ role: 'system', content: system }, { role: 'user', content: [...parts, ...reminder] }]
    let res: Response
    let raw = ''
    try {
      res = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, signal: opts.signal,
        body: JSON.stringify({ messages, temperature: (opts.temperature ?? 0.2) + attempt * 0.1, max_tokens: opts.maxTokens ?? 900, chat_template_kwargs: { enable_thinking: false }, response_format: { type: 'json_schema', json_schema: { name: 'answer', strict: true, schema: opts.schema } } })
      })
    } catch (e) { if (opts.signal?.aborted) throw e; lastError = e instanceof Error ? e.message : String(e); continue }
    if (!res.ok) { lastError = `HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`; continue }
    try {
      const j = (await res.json()) as { choices: Array<{ message: { content: string }; finish_reason?: string }> }
      const c = j.choices[0]
      raw = c.message.content
      if (c.finish_reason === 'length') throw new Error('Antwort abgeschnitten (Token-Grenze)')
      return opts.validate(JSON.parse(raw))
    } catch (e) { lastError = (e instanceof Error ? e.message : String(e)) + (raw ? ` | Anfang: ${raw.slice(0, 120)}` : '') }
  }
  throw new Error(`Modellantwort ungültig: ${lastError}`)
}
