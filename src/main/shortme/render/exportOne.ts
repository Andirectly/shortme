// Ein Clip wie im Nutzer-Export (aus ipc.renderClips herausgelöst): Editor-Operationen, Stil, Preset, Renderer, Cold Opener, Hook.
// `inputFingerprint` bindet die Datei an genau diese Eingaben – Engine 6 prüft die so erzeugte Datei, der Export darf sie unverändert wiederverwenden,
// solange der Fingerabdruck gleich ist (geänderter Plan, Stil, Preset, Renderer oder Bearbeitung → neuer Render, alter Prüfstatus gilt nicht).
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { copyFile, mkdir } from 'node:fs/promises'
import { probeOutput } from '../clips/engines/v4/media'
import { safeFileName, uniquePath } from './profiles'
import type { ExportResult } from './exporter'
import type { ShortmeClip } from '@shared/shortme'
import type { ProjectMeta } from '../project'
import type { Transcript } from '../transcription'
import { activeModelId } from '../../testlab/registry'
import { loadStyle } from '../styleDefaults'
import { ensureLayoutInput, ensureSignals, loadLayoutInput } from '../clips/analysis'
import { exportClip } from './exporter'
import { loadEdits } from '../edits'
import { baseState, effectiveClip, stateOf } from '../../../shared/edits'
import { allPresets, effectivePreset } from '../presets'

export const EXPORT_PIPELINE_REVISION = 'export-v1'

export async function exportEffective(meta: ProjectMeta, transcript: Transcript, clip: ShortmeClip, outDir: string, opts: { srt?: boolean; captions?: boolean; /** false = nie die geprüfte Engine-6-Datei übernehmen (Recheck braucht Wörter und eine frische Datei) */ reuse?: boolean } | undefined, signal: AbortSignal | undefined, onProgress?: (f: number, m: string) => void) {
  const signals = await ensureSignals(meta)
  const style = await loadStyle()
  const edits = await loadEdits(meta.hash, clip.id)
  const st = stateOf(baseState(clip, undefined, style), edits)
  const layoutInput = (await loadLayoutInput(meta.hash, clip.id)) ?? (await ensureLayoutInput(meta, clip))
  const eff = effectiveClip(clip, transcript.words, st, layoutInput)
  const preset = effectivePreset(await allPresets(), st.caption)
  const renderer = (await activeModelId('renderer')) === 'remotion_renderer' ? 'remotion' as const : 'tscaps' as const
  // „Nur Untertitel“: fertiges Video bleibt unverändert – keine Pausenschnitte, kein Cold Opener, kein Hook (nur wenn gesetzt: Fingerabdrücke anderer Clips bleiben gleich)
  const only = clip.captionOnly ? { removePauses: false } : {}
  const params = { ...only, style: preset, srt: !!opts?.srt, captions: opts?.captions !== false && st.caption.enabled !== false, extraCuts: eff.removed, wordEdits: eff.wordEdits, coldOpenSec: clip.captionOnly ? 0 : style.coldOpenSec ?? 0, hook: clip.captionOnly ? false : st.hook.enabled, renderer, seamCaption: st.caption.style.caption?.y === undefined, seamTitle: st.caption.style.title?.y === undefined, caption: { highlight: st.caption.highlight }, hookSeconds: st.hook.seconds, hookText: st.hook.text }
  // Tonspuren/Pegel nur wenn gesetzt: Fingerabdrücke unbearbeiteter Clips bleiben gleich
  Object.assign(params, st.audio.length ? { audio: st.audio } : {}, st.voiceDb ? { voiceDb: st.voiceDb } : {})
  const inputFingerprint = createHash('sha256').update(JSON.stringify([EXPORT_PIPELINE_REVISION, meta.hash, eff.start, eff.end, eff.shots, eff.title, eff.firstWord, eff.lastWord, (eff as { autoCuts?: unknown }).autoCuts ?? null, params])).digest('hex').slice(0, 24)
  // Engine 6: unveränderte, geprüfte Datei wiederverwenden (gleiche Eingaben UND unveränderter Inhalt); sonst neu rendern – der alte Prüfstatus gilt dann nicht
  const art = clip.v6?.artifact
  if (art && opts?.reuse !== false && !opts?.srt && art.inputFingerprint === inputFingerprint && existsSync(art.path)) {
    const pr = await probeOutput(art.path, signal).catch(() => null)
    if (pr && pr.sha256 === art.sha256) {
      await mkdir(outDir, { recursive: true })
      const path = uniquePath(outDir, safeFileName(eff.title))
      await copyFile(art.path, path)
      onProgress?.(1, 'geprüfte Datei übernommen')
      return { exp: { path, durationSec: pr.durationSeconds, ass: '', wordsOut: [], pieces: 0, captionEngine: renderer } as ExportResult, eff, st, inputFingerprint, reused: true }
    }
  }
  const exp = await exportClip(meta, eff, transcript, signals, { outDir, ...params, signal, onProgress })
  return { exp, eff, st, inputFingerprint, reused: false }
}
