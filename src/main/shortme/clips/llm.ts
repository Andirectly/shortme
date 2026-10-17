import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'

/** Prompts liegen als Textdateien in resources/prompts (ohne Code-Änderung tunebar). */
export function promptDir(): string {
  if (app?.isPackaged) return join(process.resourcesPath, 'prompts')
  return join(process.env.SHORTME_PROMPTS ?? process.cwd(), process.env.SHORTME_PROMPTS ? '' : 'resources/prompts')
}

export interface Prompt { system: string; user: string }

/** Datei = System-Teil, `---USER---`, User-Teil; `{{name}}` wird ersetzt. */
export async function loadPrompt(name: string, vars: Record<string, string | number>): Promise<Prompt> {
  const raw = await readFile(join(promptDir(), `${name}.md`), 'utf8')
  const [sys, usr = ''] = raw.split(/^---USER---\s*$/m)
  const fill = (s: string): string => s.replace(/\{\{(\w+)\}\}/g, (_, k: string) => String(vars[k] ?? '')).trim()
  return { system: fill(sys), user: fill(usr) }
}

export interface ChatJsonOptions<T> {
  schema: object
  validate: (x: unknown) => T
  maxTokens?: number
  temperature?: number
  signal?: AbortSignal
}

/** OpenAI-kompatibler Aufruf an llama-server mit erzwungenem JSON-Schema; ungültige Antworten werden 1× wiederholt. */
export async function chatJson<T>(baseUrl: string, prompt: Prompt, opts: ChatJsonOptions<T>): Promise<T> {
  let lastError = ''
  for (let attempt = 0; attempt < 2; attempt++) {
    opts.signal?.throwIfAborted()
    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: opts.signal,
      body: JSON.stringify({
        messages: [{ role: 'system', content: prompt.system }, { role: 'user', content: prompt.user + (lastError ? `\n\n(Vorherige Antwort war ungültig: ${lastError}. Antworte exakt im Schema.)` : '') }],
        temperature: (opts.temperature ?? 0.3) + attempt * 0.2,
        max_tokens: opts.maxTokens ?? 1500,
        chat_template_kwargs: { enable_thinking: false },
        response_format: { type: 'json_schema', json_schema: { name: 'answer', strict: true, schema: opts.schema } }
      })
    })
    if (!res.ok) { lastError = `HTTP ${res.status}`; continue }
    try {
      const j = (await res.json()) as { choices: Array<{ message: { content: string } }> }
      return opts.validate(JSON.parse(j.choices[0].message.content))
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e)
    }
  }
  throw new Error(`LLM-Antwort ungültig: ${lastError}`)
}

export const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)
export const int = (x: unknown, lo: number, hi: number, name: string): number => {
  if (typeof x !== 'number' || !Number.isFinite(x)) throw new Error(`${name}: Zahl erwartet`)
  return Math.min(hi, Math.max(lo, Math.round(x)))
}
export const str = (x: unknown, max: number, name: string): string => {
  if (typeof x !== 'string' || !x.trim()) throw new Error(`${name}: Text erwartet`)
  return x.trim().slice(0, max)
}
