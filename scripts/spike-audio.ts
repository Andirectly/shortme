/**
 * Spike: Audio-Eingabe von Gemma 4 über llama-server (--mmproj). Schickt die Finalisten (Clips aus spikes/out) als 16-kHz-WAV
 * zusammen mit dem Transkript und fragt nach Energie/Humor/Betonung im Ton.
 *   SHORTME_DATA=<absolut> npx tsx --tsconfig tsconfig.node.json scripts/spike-audio.ts <video> [anzahl]
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { importFile } from '../src/main/shortme/importer'
import { loadTranscript } from '../src/main/shortme/transcription'
import { FFMPEG_PATH } from '../src/main/pipeline/ffmpeg'
import { LlamaServer, killAllSidecars } from '../src/main/engines/sidecars'

const SPIKE = resolve('.tmp/spike-models')

async function main(): Promise<void> {
  const video = process.argv[2]
  const n = Number(process.argv[3] ?? 4)
  const imp = await importFile(video)
  const t = (await loadTranscript(imp.meta.hash))!
  const res = JSON.parse(readFileSync(`spikes/out/gemma4-12b__${basename(video, '.mp4')}.json`, 'utf8')) as { clips: Array<{ start: number; end: number; title: string }> }
  const srv = new LlamaServer()
  const url = await srv.start({ model: join(SPIKE, 'gemma-4-12b-it-qat-q4_0.gguf'), mmproj: join(SPIKE, 'mmproj-gemma-4-12b-it-qat-q4_0.gguf'), ctx: 16384 })
  const log: string[] = []
  for (const c of res.clips.slice(0, n)) {
    const wav = join('.tmp', `spike-${Math.round(c.start)}.wav`)
    // CONTROL=1: Stille statt Ton – wenn die Bewertung gleich bleibt, ignoriert das Modell den Ton
    if (process.env.CONTROL) execFileSync(FFMPEG_PATH, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'anullsrc=r=16000:cl=mono', '-t', String(Math.min(60, c.end - c.start)), wav])
    else execFileSync(FFMPEG_PATH, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(c.start), '-t', String(Math.min(60, c.end - c.start)), '-i', imp.meta.sourcePath, '-ac', '1', '-ar', '16000', wav])
    const text = t.words.filter((w) => w.start >= c.start && w.end <= c.end).map((w) => w.w).join(' ')
    const b64 = readFileSync(wav).toString('base64')
    const t0 = Date.now()
    const body = {
      messages: [{ role: 'user', content: [
        { type: 'input_audio', input_audio: { data: b64, format: 'wav' } },
        { type: 'text', text: process.env.LISTEN ? 'Höre dir die Audioaufnahme an. Wie viele verschiedene Stimmen hörst du? Wird gelacht? Ist Musik oder Stille zu hören? Gib den Anfang des Gesagten wörtlich wieder. Antworte in 2 Sätzen.' : `Das ist der Ton eines Kurzvideo-Kandidaten. Transkript: „${text.slice(0, 1500)}“\n\nBewerte NUR aus dem Ton (nicht aus dem Text): energie (0-4), humor_im_ton (0-4: Lachen, Ironie), betonung (0-4: Überraschung, Nachdruck), und beschreibe in einem Satz den Tonfall. Antworte als JSON {"energie":int,"humor_im_ton":int,"betonung":int,"tonfall":string}.` }
      ] }],
      max_tokens: 300, temperature: 0.2, chat_template_kwargs: { enable_thinking: false }
    }
    let out = ''
    try {
      const r = await fetch(`${url}/v1/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      const j = (await r.json()) as { choices?: Array<{ message: { content: string } }>; error?: { message: string } }
      out = j.choices?.[0]?.message.content ?? `FEHLER ${JSON.stringify(j.error ?? j).slice(0, 300)}`
    } catch (e) { out = `FEHLER ${String(e).slice(0, 300)}` }
    const line = `${c.start.toFixed(0)}–${c.end.toFixed(0)} s „${c.title}“ (${((Date.now() - t0) / 1000).toFixed(1)} s): ${out.replace(/\s+/g, ' ').slice(0, 400)}`
    log.push(line)
    console.log('AUDIO', line)
  }
  writeFileSync(`spikes/out/gemma-audio${process.env.CONTROL ? '-control' : ''}__${basename(video, '.mp4')}.txt`, log.join('\n'))
  console.log('server-log-tail:', srv.log.slice(-300).replace(/\s+/g, ' '))
  await srv.stop()
  await killAllSidecars()
  process.exit(0)
}
main().catch((e) => { console.error('FAIL', e); process.exit(1) })
