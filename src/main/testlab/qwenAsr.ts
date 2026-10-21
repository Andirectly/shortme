// Qwen3-ASR 1.7B (nur Text) über llama-server (mtmd, Audio-Projektor): kein Python. Kurze Stücke (≤ 25 s), weil lange Audios in llama.cpp noch Probleme machen.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { dataRoot } from '../engines/paths'
import { runFfmpeg } from '../pipeline/ffmpeg'
import { withLlmModel } from '../engines'
import { withAsr } from '../engines'
import { transcribeWav } from '../engines/asr/client'
import type { AsrSegment } from '../engines/asr/protocol'
import { applyInserts, mergeQwenText } from '../../shared/wordDiff'

export const QWEN_ASR_ASSET = 'qwen3-asr'
/** Bekannte Fehler bei langem Audio: Stücke ≤ 30 s (hier 25 s). */
const CHUNK = 25

/** „language German<asr_text>Hallo …“ → „Hallo …“ */
export function cleanAsrText(raw: string): string {
  return raw.replace(/^\s*language\s+[A-Za-z]+\s*/i, '').replace(/<\/?asr_text>/gi, '').trim()
}

async function transcribeChunk(url: string, wavPath: string): Promise<string> {
  const data = (await readFile(wavPath)).toString('base64')
  const res = await fetch(`${url}/v1/chat/completions`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: [{ type: 'input_audio', input_audio: { data, format: 'wav' } }] }], temperature: 0, max_tokens: 1024 })
  })
  if (!res.ok) throw new Error(`Qwen3-ASR: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`)
  const j = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
  return cleanAsrText(j.choices?.[0]?.message?.content ?? '')
}

/** Text je Stück; Zeiten der Wörter nur gleichmäßig über das Stück verteilt (Anzeige). */
export async function qwenAsrText(wav: string, durSec: number): Promise<AsrSegment[]> {
  return withLlmModel(QWEN_ASR_ASSET, async (url) => {
    const out: AsrSegment[] = []
    const dir = join(dataRoot(), 'testlab')
    for (let a = 0; a < durSec; a += CHUNK) {
      const len = Math.min(CHUNK, durSec - a)
      const part = join(dir, `qwenasr-part-${Math.round(a)}.wav`)
      await runFfmpeg(['-y', '-ss', String(a), '-t', String(len), '-i', wav, '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', part])
      const text = await transcribeChunk(url, part)
      const toks = text.split(/\s+/).filter(Boolean)
      const words = toks.map((w, i) => ({ w, start: a + (i / Math.max(1, toks.length)) * len, end: a + ((i + 1) / Math.max(1, toks.length)) * len }))
      out.push({ start: a, end: a + len, text, words })
    }
    return out
  })
}

/** Text (Wörter) für mehrere Zeitbereiche der Aufnahme in EINER Server-Sitzung; je Bereich in Stücken ≤ 25 s. */
export async function qwenTextForRanges(wav: string, ranges: Array<[number, number]>): Promise<string[][]> {
  return withLlmModel(QWEN_ASR_ASSET, async (url) => {
    const dir = join(dataRoot(), 'testlab')
    const out: string[][] = []
    for (const [r0, r1] of ranges) {
      const toks: string[] = []
      for (let a = r0; a < r1; a += CHUNK) {
        const len = Math.min(CHUNK, r1 - a)
        if (len < 0.5) continue
        const part = join(dir, 'qwenasr-range.wav')
        await runFfmpeg(['-y', '-ss', String(a), '-t', String(len), '-i', wav, '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', part])
        toks.push(...(await transcribeChunk(url, part)).split(/\s+/).filter(Boolean))
      }
      out.push(toks)
    }
    return out
  })
}

/** Testlab/Pipeline: Parakeet (Zeiten) + Qwen3-ASR (Text): Schreibweisen aus Qwen, Einfügungen mit geschätzten Zeiten, Parakeet-only bleibt. */
export async function qwenMerged(wav: string, durSec: number): Promise<AsrSegment[]> {
  const base = await withAsr(() => transcribeWav(wav))
  const orig = base.segments.flatMap((s) => s.words).sort((a, b) => a.start - b.start)
  const speech = base.segments.map((s) => [s.start, s.end] as [number, number])
  const qwen = (await qwenAsrText(wav, durSec)).flatMap((s) => s.words.map((w) => w.w))
  const m = mergeQwenText(orig, qwen, speech)
  const withSubs = orig.map((w, i) => (m.subs[i] ? { ...w, w: m.subs[i] } : w))
  const out = applyInserts(withSubs, m.inserts).words
  return [{ start: out[0]?.start ?? 0, end: out[out.length - 1]?.end ?? durSec, text: out.map((w) => w.w).join(' '), words: out }]
}
