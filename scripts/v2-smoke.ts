/**
 * Engine V2: echter Inferenz-Smoke-Test der beiden Beobachtungsmodelle (Bild: Qwen3-VL-4B, Ton: Voxtral-Mini-3B).
 * Installiert die Modelle über den Modell-Manager (Prüfsumme), startet llama-server je Modell mit Projektor, übergibt reale Frames bzw. einen realen
 * Tonausschnitt aus einem Video und gibt die Antworten aus.
 *
 *   SHORTME_DATA=<Datenordner> npx tsx --tsconfig tsconfig.node.json scripts/v2-smoke.ts <video> [bildzeit-s] [ton-start-s] [ton-ende-s]
 */
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { assets, llama, withAudio, withVision } from '../src/main/engines'
import { killAllSidecars } from '../src/main/engines/sidecars'
import { assetDir } from '../src/main/engines/paths'
import { FFMPEG_PATH } from '../src/main/pipeline/ffmpeg'
import { audioPart, chatMm, imagePart, textPart } from '../src/main/shortme/clips/engines/v2/mm'
import { cutWav, grabJpeg } from '../src/main/shortme/clips/engines/v2/media'

const video = process.argv[2]
const tImg = Number(process.argv[3] ?? 60)
const a0 = Number(process.argv[4] ?? 60)
const a1 = Number(process.argv[5] ?? 90)
if (!video) { console.error('Aufruf: v2-smoke.ts <video> [bildzeit] [ton-start] [ton-ende]'); process.exit(2) }

async function main(): Promise<void> {
  let last = 0
  assets.on('status', (s) => { if (s.state !== 'downloading' || Date.now() - last > 20000) { last = Date.now(); console.log(`  ${s.id} ${s.state} ${(s.progress * 100).toFixed(0)}%`) } })
  for (const id of ['llama-server', 'qwen3-vl-4b', 'voxtral-mini-3b']) await assets.install(id)

  // Bild: drei Frames (kurz davor, Ereignis, kurz danach) mit Kennungen, Antwort gegen ein Schema
  const times = [tImg - 2, tImg, tImg + 2]
  const frames = await Promise.all(times.map((t) => grabJpeg(video, t)))
  const t0 = Date.now()
  const vis = await withVision((url) => chatMm<{ frames: Array<{ id: string; sichtbar: string }>; handlung: string; reaktion: string; unsicher: boolean }>(
    url, 'Du beschreibst nur, was auf den Bildern zu sehen ist. Erfinde nichts.',
    [textPart('Drei aufeinanderfolgende Bilder eines Streams (F1 ältestes, F3 neuestes). Beschreibe je Bild in höchstens 15 Wörtern, was sichtbar ist, dann die erkennbare Handlung und eine sichtbare Reaktion der Person. unsicher = true, wenn du etwas nicht erkennen kannst.'),
      ...frames.flatMap((f, i) => [textPart(`Bild F${i + 1}:`), imagePart(f)])],
    { maxTokens: 900, schema: { type: 'object', additionalProperties: false, required: ['frames', 'handlung', 'reaktion', 'unsicher'], properties: { frames: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'sichtbar'], properties: { id: { type: 'string' }, sichtbar: { type: 'string' } } } }, handlung: { type: 'string' }, reaktion: { type: 'string' }, unsicher: { type: 'boolean' } } }, validate: (x) => x as never }))
  console.log(`BILD (${((Date.now() - t0) / 1000).toFixed(1)} s, Modell ${llama.model?.split(/[\\/]/).pop() ?? '?'}):`, JSON.stringify(vis))

  // Ton: Audioausschnitt aus der Originaldatei (16 kHz mono), Frage nach Sprechen/Gesang/Rap und Reaktionen
  const wavPath = join(process.env.TEMP ?? '.', 'v2-smoke-audio.wav')
  execFileSync(FFMPEG_PATH, ['-hide_banner', '-loglevel', 'error', '-y', '-i', video, '-vn', '-ac', '1', '-ar', '16000', '-ss', String(a0), '-t', String(a1 - a0), wavPath])
  const wav = await cutWav(wavPath, 0, a1 - a0)
  const t1 = Date.now()
  const aud = await withAudio((url) => chatMm<{ art: string; wechsel: boolean; reaktionen: string; unsicher: boolean }>(
    url, 'Du hörst einen kurzen Tonausschnitt aus einem Stream und beschreibst nur, was du hörst. Erfinde nichts. Antworte als JSON.\n\nFrage: Wird gesprochen, gesungen oder gerappt? Gibt es einen Wechsel der Sprechweise oder Stimme? Sind Reaktionen wie Lachen, Schreien oder Applaus zu hören? Setze unsicher = true, wenn du es nicht sicher erkennst.',
    [audioPart(wav)],
    { noSystem: true, maxTokens: 300, schema: { type: 'object', additionalProperties: false, required: ['art', 'wechsel', 'reaktionen', 'unsicher'], properties: { art: { type: 'string' }, wechsel: { type: 'boolean' }, reaktionen: { type: 'string' }, unsicher: { type: 'boolean' } } }, validate: (x) => x as never }))
  console.log(`TON (${((Date.now() - t1) / 1000).toFixed(1)} s, Modell ${llama.model?.split(/[\\/]/).pop() ?? '?'}):`, JSON.stringify(aud))
  console.log('ASSETS', assetDir('qwen3-vl-4b'), assetDir('voxtral-mini-3b'))
}

main().catch((e) => { console.error('SMOKE FEHLER', e); process.exitCode = 1 }).finally(() => killAllSidecars().then(() => process.exit()))
