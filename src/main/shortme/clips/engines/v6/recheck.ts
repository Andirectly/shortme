// Engine 6 – Recheck eines einzelnen Clips (Kap. 16): aktueller Stand inkl. Bearbeitungen wird wie im Export gerendert und mit dem Engine-6-Prüfpfad
// geprüft (Technik + ganze Ausgabe in AV-Paketen + redaktionelles Urteil). Keine neue Ganzvideo-Suche; Ergebnis gebunden an SHA-256 dieser Datei.
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { ShortmeClip } from '@shared/shortme'
import type { ProjectMeta } from '../../../project'
import { projectFile } from '../../../project'
import type { Transcript } from '../../../transcription'
import { exportEffective } from '../../../render/exportOne'
import { splitSentences } from '../../sentences'
import { measuredCriteria, type Rendered } from '../v4/finalize'
import { adapterFor } from './adapters'
import { decideV6, judgeEditorial, observeRendered, technicalCheck, V6_AUDIT_REVISION, type OutputAudit } from './audit'

export async function recheckV6(meta: ProjectMeta, t: Transcript, clip: ShortmeClip, dir: string, signal?: AbortSignal): Promise<OutputAudit> {
  const A = adapterFor()
  await mkdir(dir, { recursive: true })
  const hasAudio = meta.hasAudio !== false
  const { exp, eff } = await exportEffective(meta, t, clip, join(dir, 'output'), { captions: true, reuse: false }, signal)
  const tech = await technicalCheck(exp.path, { durationSec: exp.durationSec, hasAudio }, signal)
  const h = createHash('sha256')
  await new Promise<void>((res, rej) => createReadStream(exp.path).on('data', (d) => h.update(d)).on('end', () => res()).on('error', rej))
  const sha256 = h.digest('hex')
  const rendered: Rendered = { path: exp.path, sha256, durationSeconds: tech.durationSec || exp.durationSec, streams: tech.streams.filter((s): s is 'video' | 'audio' => s === 'video' || s === 'audio'), clip: eff, trims: [], pieces: exp.pieces, faceRatio: null, emptyShots: eff.shots?.filter((s) => s.auto === 'empty').length ?? 0, layoutOk: !!eff.shots?.length, captionWords: exp.wordsOut.length }
  const { packets, measured } = await A.withAv(`rc6-${Date.now().toString(36)}`, async (s) => ({ packets: await observeRendered(s, exp.path, rendered.durationSeconds, hasAudio, join(dir, 'tmp'), signal), measured: (await measuredCriteria(rendered, projectFile(meta.hash, 'audio.wav'), hasAudio, [], signal)).criteria }))
  const words = exp.wordsOut.map((w) => w.w).join(' ')
  const sentencesText = splitSentences(t.words).filter((s) => s.first >= eff.firstWord && s.last <= eff.lastWord).map((s) => s.text).join(' ')
  const wordless = !words.trim()
  const editorial = await A.withText((url, model) => judgeEditorial(url, { durationSec: rendered.durationSeconds, text: words || sentencesText, wordless, packets, measured, lang: 'der Clip-Sprache' }, model, signal)).catch(() => null)
  const crit = [...(editorial?.criteria ?? []), ...measured]
  const coverageOk = packets.length > 0 && packets.every((p) => p.ok)
  const status = decideV6(tech, coverageOk && !!editorial, crit, wordless)
  const observedSec = packets.filter((p) => p.ok).reduce((n, p) => n + (p.end - p.start), 0)
  return { clipId: clip.id, attemptId: 'recheck', planFingerprint: '', sha256, auditRevision: V6_AUDIT_REVISION, models: { av: A.models.av, text: A.models.text }, technical: tech, packets, coverage: { outputSec: rendered.durationSeconds, observedSec, packets: packets.length, failedPackets: packets.filter((p) => !p.ok).length }, criteria: crit, status, technicalStatus: tech.ok ? 'pass' : 'fail', editorialStatus: !editorial ? 'unknown' : status === 'verified' ? 'pass' : 'needs-review', title: editorial?.title ?? '', at: new Date().toISOString() }
}
