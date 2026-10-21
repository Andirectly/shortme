// Zweiter Transkriptions-Durchgang für ausgewählte Clips (Testlab-Platz „Clip-Transkription“). Standard: aus (Parakeet-Transkript bleibt).
// Aktiv nur, wenn im Testlab „Parakeet, zweiter Durchgang“ gewählt wurde: die Clips werden zusammenhängend (ohne VAD-Vorfilter) neu dekodiert;
// übernommen werden nur andere Schreibweisen einzelner Wörter (Korrekturen). Wortzahl, Indizes und Wortzeiten bleiben unverändert.
import { withAsr } from '../../engines'
import { transcribeRanges } from '../../engines/asr/client'
import type { Range } from '../../engines/asr/protocol'
import { projectFile } from '../project'
import { activeModelId } from '../../testlab/registry'
import { substitutions } from '../../../shared/wordDiff'
import type { ShortmeClip } from '../../../shared/shortme'
import type { Transcript } from '../transcription'

export const SECOND_PASS_MODEL = 'parakeet_pass2'

export async function secondPassEnabled(): Promise<boolean> {
  try { return (await activeModelId('clip_asr')) === SECOND_PASS_MODEL } catch { return false }
}

/** Korrekturen (globaler Wortindex → Schreibweise) je Clip aus dem zweiten Durchgang; vorhandene Korrekturen haben Vorrang. */
export async function secondPassCorrections(hash: string, t: Transcript, clips: ShortmeClip[], signal?: AbortSignal): Promise<ShortmeClip[]> {
  const wav = projectFile(hash, 'audio.wav')
  const ranges: Range[] = clips.map((c) => [Math.max(0, c.start - 0.2), Math.min(t.durationSec, c.end + 0.2)])
  const segments = await withAsr(() => transcribeRanges(wav, ranges, { signal }))
  const second = segments.flatMap((s) => s.words).sort((a, b) => a.start - b.start)
  return clips.map((c) => {
    const orig = t.words.slice(c.firstWord, c.lastWord + 1)
    const mine = second.filter((w) => w.start >= c.start - 0.2 && w.end <= c.end + 0.2)
    const subs = substitutions(orig.map((w) => w.w), mine.map((w) => w.w))
    const corrections: Record<number, string> = { ...(c.corrections ?? {}) }
    for (const [i, text] of Object.entries(subs)) if (corrections[c.firstWord + Number(i)] === undefined) corrections[c.firstWord + Number(i)] = text
    return { ...c, corrections }
  })
}
