// Zweiter Transkriptions-Durchgang für ausgewählte Clips (Testlab-Platz „Clip-Transkription“). Standard: aus (Parakeet-Transkript bleibt).
// Aktiv nur, wenn im Testlab ein zweiter Durchgang gewählt wurde:
//  · parakeet_pass2: Clips zusammenhängend (ohne VAD) neu dekodiert; nur andere Schreibweisen werden als Korrekturen übernommen (Indizes bleiben).
//  · qwen3_asr_17b: Qwen3-ASR (llama-server) liefert den Text, Wortzeiten kommen von Parakeet; Wörter, die nur Qwen erkannt hat, werden mit
//    geschätzten Zeiten eingefügt (Transkript wächst, Indizes werden umgerechnet); Wörter nur bei Parakeet bleiben.
import { withAsr } from '../../engines'
import { transcribeRanges } from '../../engines/asr/client'
import type { Range } from '../../engines/asr/protocol'
import { projectFile } from '../project'
import { writeFileAtomic } from '../atomic'
import { activeModelId } from '../../testlab/registry'
import { qwenTextForRanges } from '../../testlab/qwenAsr'
import { applyInserts, mergeQwenText, substitutions, type Insert } from '../../../shared/wordDiff'
import type { ShortmeClip } from '../../../shared/shortme'
import type { Transcript } from '../transcription'
import { remapClip, remapSegments } from './remap'

export type SecondPassKind = 'parakeet_pass2' | 'qwen3_asr_17b'

export async function secondPassKind(): Promise<SecondPassKind | null> {
  try { const id = await activeModelId('clip_asr'); return id === 'parakeet_pass2' || id === 'qwen3_asr_17b' ? id : null } catch { return null }
}

/** Ergebnis: Clips (ggf. mit neuen Indizes), Transkript (bei Qwen mit eingefügten Wörtern) und Zahlen für den Bericht. */
export async function applySecondPass(kind: SecondPassKind, hash: string, t: Transcript, clips: ShortmeClip[], signal?: AbortSignal): Promise<{ clips: ShortmeClip[]; transcript: Transcript; substituted: number; inserted: number }> {
  const wav = projectFile(hash, 'audio.wav')
  const ranges: Range[] = clips.map((c) => [Math.max(0, c.start - 0.2), Math.min(t.durationSec, c.end + 0.2)])

  if (kind === 'parakeet_pass2') {
    const segments = await withAsr(() => transcribeRanges(wav, ranges, { signal }))
    const second = segments.flatMap((s) => s.words).sort((a, b) => a.start - b.start)
    let substituted = 0
    const out = clips.map((c) => {
      const orig = t.words.slice(c.firstWord, c.lastWord + 1)
      const mine = second.filter((w) => w.start >= c.start - 0.2 && w.end <= c.end + 0.2)
      const subs = substitutions(orig.map((w) => w.w), mine.map((w) => w.w))
      const corrections: Record<number, string> = { ...(c.corrections ?? {}) }
      for (const [i, text] of Object.entries(subs)) if (corrections[c.firstWord + Number(i)] === undefined) { corrections[c.firstWord + Number(i)] = text; substituted++ }
      return { ...c, corrections }
    })
    return { clips: out, transcript: t, substituted, inserted: 0 }
  }

  // Qwen3-ASR: Text je Clip, ein llama-server-Lauf für alle Clips
  const texts = await qwenTextForRanges(wav, ranges)
  const all: Insert[] = []
  const subsByIndex = new Map<number, string>()
  clips.forEach((c, k) => {
    const orig = t.words.slice(c.firstWord, c.lastWord + 1)
    const speech = t.speech.filter(([a, b]) => b > c.start && a < c.end)
    const m = mergeQwenText(orig, texts[k], speech)
    for (const [i, text] of Object.entries(m.subs)) subsByIndex.set(c.firstWord + Number(i), text)
    for (const ins of m.inserts) {
      // Überlappende Clips: dieselbe Stelle nur einmal einfügen
      const before = c.firstWord + ins.before
      if (!all.some((x) => x.before === before)) all.push({ before, words: ins.words })
    }
  })
  const withSubs = t.words.map((w, i) => (subsByIndex.has(i) ? { ...w, w: subsByIndex.get(i)! } : w))
  const merged = applyInserts(withSubs, all)
  const result: Transcript = { ...t, words: merged.words, segments: remapSegments(t.segments, merged.map, merged.words.length) }
  const remapped = clips.map((c) => remapClip(c, { map: merged.map, starts: merged.starts, inserts: all }, merged.words.length))
  if (all.length) await writeFileAtomic(projectFile(hash, 'transcript.json'), JSON.stringify(result))
  return { clips: remapped, transcript: result, substituted: subsByIndex.size, inserted: all.reduce((n, g) => n + g.words.length, 0) }
}
