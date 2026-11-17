import { useEffect, useMemo, useRef, useState } from 'react'
import { Pause, Play } from 'lucide-react'
import { clipPieces, sourceToOutputTime, type Span } from '@shared/compare'
import { Button, Segmented } from './ui'

export interface SyncMember { key: string; label: string; start: number; end: number; autoCuts: Span[] }
const mmss = (s: number): string => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

/** Zustand einer Quellzeit in einem Clip: spielt, liegt vor/nach dem Clip, oder wurde im Schnitt ausgelassen (nie eine verschobene Scheinzeit). */
export function memberState(m: Pick<SyncMember, 'start' | 'end' | 'autoCuts'>, t: number): 'play' | 'outside' | 'omitted' {
  if (t < m.start || t > m.end) return 'outside'
  return sourceToOutputTime(clipPieces(m), t) === 'omitted' ? 'omitted' : 'play'
}

/** Gemeinsame Quellzeit-Achse: alle Spalten folgen einer Uhr; wo ein Clip die Quellzeit nicht enthält, pausiert er mit Hinweis. Zeigt das Original (ohne Ausschnitt/Untertitel). */
export function SyncPlayers({ src, members, union }: { src: string; members: SyncMember[]; union: Span }): React.JSX.Element {
  const [t, setT] = useState(union.start)
  const [playing, setPlaying] = useState(false)
  const [audio, setAudio] = useState(0)
  const vids = useRef<Array<HTMLVideoElement | null>>([])
  useEffect(() => {
    if (!playing) return
    let raf = 0, last = performance.now()
    const tick = (now: number): void => { const dt = (now - last) / 1000; last = now; setT((p) => { const n = p + dt; if (n >= union.end) { setPlaying(false); return union.end } return n }); raf = requestAnimationFrame(tick) }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, union.end])
  useEffect(() => {
    members.forEach((m, i) => {
      const v = vids.current[i]
      if (!v) return
      if (memberState(m, t) !== 'play') { if (!v.paused) v.pause(); return }
      if (Math.abs(v.currentTime - t) > 0.3) v.currentTime = t
      if (playing && v.paused) void v.play().catch(() => undefined)
      if (!playing && !v.paused) v.pause()
    })
  }, [t, playing, members])
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ display: 'grid', gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
        {members.map((m, i) => {
          const st = memberState(m, t)
          return (
            <div key={m.key} style={{ position: 'relative', background: '#000', borderRadius: 10, overflow: 'hidden', aspectRatio: '16 / 9' }}>
              <video ref={(el) => { vids.current[i] = el }} src={src} muted={audio !== i} preload="auto" playsInline style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block', opacity: st === 'play' ? 1 : 0.25 }} onLoadedMetadata={(e) => { e.currentTarget.currentTime = union.start }} />
              <small style={{ position: 'absolute', left: 8, top: 6, background: 'rgba(0,0,0,0.6)', padding: '1px 6px', borderRadius: 6 }}>{m.label}</small>
              {st !== 'play' && <small style={{ position: 'absolute', inset: 'auto 8px 8px 8px', textAlign: 'center', background: 'rgba(0,0,0,0.7)', padding: '3px 6px', borderRadius: 6 }}>{st === 'omitted' ? 'im Schnitt ausgelassen' : t < m.start ? 'Clip beginnt später' : 'Clip ist hier zu Ende'}</small>}
            </div>
          )
        })}
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <Button variant="secondary" onClick={() => { if (t >= union.end) setT(union.start); setPlaying((p) => !p) }}>{playing ? <Pause size={14} /> : <Play size={14} />} {playing ? 'Pause' : 'Alle abspielen'}</Button>
        <input type="range" aria-label="Quellzeit" min={union.start} max={union.end} step={0.1} value={t} onChange={(e) => { setPlaying(false); setT(Number(e.target.value)) }} style={{ flex: 1, minWidth: 160 }} />
        <small>Quellzeit {mmss(t)}</small>
        <small>Ton:</small>
        <Segmented options={members.map((_, i) => String.fromCharCode(65 + i))} value={String.fromCharCode(65 + audio)} onChange={(l) => setAudio(l.charCodeAt(0) - 65)} />
      </div>
    </div>
  )
}

/** Ein Clip einzeln, mit seinen eigenen Schnitten (übersprungene Abschnitte werden nicht gezeigt). */
export function SoloClip({ src, member }: { src: string; member: SyncMember }): React.JSX.Element {
  const ref = useRef<HTMLVideoElement | null>(null)
  const pieces = useMemo(() => clipPieces(member), [member])
  const onTime = (): void => {
    const v = ref.current
    if (!v) return
    const i = pieces.findIndex((p) => v.currentTime < p.end - 0.04)
    if (i === -1) { v.pause(); v.currentTime = pieces[0].start; return }
    if (v.currentTime < pieces[i].start - 0.04) v.currentTime = pieces[i].start
  }
  return <video ref={ref} src={src} controls preload="metadata" playsInline aria-label={member.label} onLoadedMetadata={(e) => { e.currentTarget.currentTime = pieces[0]?.start ?? member.start }} onTimeUpdate={onTime} style={{ width: '100%', borderRadius: 10, background: '#000', aspectRatio: '16 / 9', objectFit: 'contain' }} />
}
