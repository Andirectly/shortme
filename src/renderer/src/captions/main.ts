// Verstecktes Renderfenster: brennt Untertitel mit @tscaps/engine in ein Video (CSS aus shared/captions.ts → Vorschau = Export).
import { LimitByWordsSegmentSplitter, RenderPipelineBuilder, VttTranscriber, WordlistTagger } from '@tscaps/engine'
import './captions.css'

interface Job {
  input: string
  output: string
  vtt: string
  css: string
  /** Vertikale Mitte 0..1 */
  y: number
  perLine: number
  width: number
  height: number
  taggers: Record<'emphasis' | 'entity' | 'hook', string[]>
}

const api = window.cutawan.captions

api.onRun(async (raw) => {
  const job = raw as Job
  try {
    const video = new Blob([await api.readFile(job.input)], { type: 'video/mp4' })
    let builder = new RenderPipelineBuilder()
      .withInputVideo(video)
      .withTranscriber(new VttTranscriber(job.vtt))
      .withSegmentSplitter(new LimitByWordsSegmentSplitter({ maxWords: job.perLine }))
      .withDefaultLineSplitterConfig({ maxLines: 1 })
      .withCss(job.css)
      .withAlignment({ verticalAlign: 'center', verticalOffset: job.y, horizontalAlign: 'center', horizontalOffset: 0.5 })
      .withOutputResolution(job.width, job.height)
      .withQuality('very-high')
    for (const [kind, words] of Object.entries(job.taggers)) if (words.length) builder = builder.addTagger(new WordlistTagger(kind, words))
    const { blob } = await builder.build().run((p) => {
      const r = (p as { inner?: { percent?: number } }).inner?.percent
      if (typeof r === 'number') api.progress(r / 100)
    })
    if (!blob) throw new Error('Renderer lieferte kein Video')
    await api.writeFile(job.output, await blob.arrayBuffer())
    api.done()
  } catch (e) {
    api.done(e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e))
  }
})
api.ready()
