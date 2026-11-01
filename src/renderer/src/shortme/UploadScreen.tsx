import { useCallback, useEffect, useMemo, useState } from 'react'
import { Upload, Link2, Unlink, Copy, Check, Sparkles } from 'lucide-react'
import { DRAFT_LIMIT, type ExportRecord, type PlatformId, type UploadJob, type UploadOverview } from '@shared/upload'
import { Button, Pill } from './ui'

const api = (): Window['cutawan']['shortme']['upload'] | null => (typeof window !== 'undefined' ? window.cutawan?.shortme?.upload ?? null : null)
const errText = (e: unknown): string => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e))
const mmss = (s: number): string => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`
const LABEL: Record<UploadJob['state'], string> = { wartend: 'Wartet', laedt: 'Lädt hoch', entwurf: 'Entwurf in deiner TikTok-App', fehler: 'Fehler' }

/** Tab „Upload“: exportierte Clips links, Plattform + Bildunterschrift + Senden rechts. Vorerst nur TikTok (Entwurf). */
export function UploadScreen(): React.JSX.Element {
  const [ov, setOv] = useState<UploadOverview | null>(null)
  const [selId, setSelId] = useState<string | null>(null)
  const [platform, setPlatform] = useState<PlatformId>('tiktok')
  const [caption, setCaption] = useState('')
  const [tags, setTags] = useState('')
  const [keys, setKeys] = useState({ key: '', secret: '' })
  const [review, setReview] = useState(false)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  const refresh = useCallback(async () => { const a = api(); if (a) setOv(await a.overview().catch(() => null)) }, [])
  useEffect(() => { const a = api(); if (!a) return; const load = (): void => void a.overview().then(setOv).catch(() => undefined); load(); return a.onChanged(load) }, [])

  const sel = useMemo<ExportRecord | null>(() => ov?.exports.find((e) => e.id === selId) ?? null, [ov, selId])
  const plat = ov?.platforms.find((p) => p.id === platform)
  const jobs = (ov?.jobs ?? []).filter((j) => j.exportId === sel?.id)
  const drafts = ov?.drafts[platform] ?? 0
  const fullText = [caption.trim(), tags.trim().split(/\s+/).filter(Boolean).map((t) => `#${t.replace(/^#/, '')}`).join(' ')].filter(Boolean).join('\n\n')

  const pick = async (e: ExportRecord): Promise<void> => {
    setSelId(e.id); setReview(false); setMsg(''); setCaption(e.hookText || e.title); setTags('')
    const a = api(); if (!a) return
    setBusy(true)
    try { const s = await a.suggest(e.id); setCaption(s.caption); setTags(s.hashtags.join(' ')) } catch (err) { setMsg(`Vorschlag nicht möglich: ${errText(err)}`) }
    setBusy(false)
  }
  const run = async (fn: () => Promise<string | null | void>): Promise<void> => { setBusy(true); setMsg(''); try { const r = await fn(); if (r) setMsg(r) } catch (e) { setMsg(errText(e)) } setBusy(false); void refresh() }
  const send = (resume?: string): Promise<void> => run(async () => { const r = await api()!.send(sel!.id, platform, fullText, resume); if (!r) setReview(false); return r })
  const copy = async (): Promise<void> => { await navigator.clipboard.writeText(fullText); setCopied(true); setTimeout(() => setCopied(false), 1500) }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.2fr)', gap: 16, paddingTop: 12, height: '100%' }}>
      <section style={{ display: 'grid', gap: 12, alignContent: 'start', minWidth: 0 }}>
        <h1 style={{ display: 'flex', gap: 10, alignItems: 'center' }}><Upload size={26} /> Upload</h1>
        {ov && ov.exports.length === 0 && <div className="sm-glass" style={{ padding: 18 }}><small>Noch nichts exportiert. Exportierte Clips erscheinen hier.</small></div>}
        {ov?.exports.map((e) => (
          <button key={e.id} className="sm-glass" onClick={() => void pick(e)} aria-pressed={e.id === selId} style={{ display: 'grid', gridTemplateColumns: '64px minmax(0, 1fr)', gap: 12, padding: 10, textAlign: 'left', outline: e.id === selId ? '2px solid var(--accent)' : 'none' }}>
            <video src={window.cutawan.mediaUrl(e.path)} preload="metadata" muted style={{ width: 64, height: 114, objectFit: 'cover', borderRadius: 10, background: '#000' }} />
            <span style={{ display: 'grid', gap: 4, alignContent: 'center', minWidth: 0 }}>
              <strong style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.title}</strong>
              <small>{mmss(e.durationSec)}</small>
              {(ov.jobs.filter((j) => j.exportId === e.id).slice(0, 1)).map((j) => <span key={j.id} className="sm-tag" style={{ width: 'fit-content' }}>{LABEL[j.state]}</span>)}
            </span>
          </button>
        ))}
      </section>

      <section className="sm-glass" style={{ padding: 18, display: 'grid', gap: 14, alignContent: 'start', minWidth: 0 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {ov?.platforms.map((p) => <Pill key={p.id} pressed={p.id === platform} disabled={!p.available} onClick={() => setPlatform(p.id)}>{p.name}</Pill>)}
        </div>

        {plat?.available && (
          <div style={{ display: 'grid', gap: 10 }}>
            {plat.needsSetup ? (
              <>
                <small>Einmalig: Client key und Client secret aus dem TikTok-Entwicklerportal (Sandbox). Anleitung: docs/UPLOAD-SETUP.md</small>
                <input className="sm-input" aria-label="Client key" placeholder="Client key" value={keys.key} onChange={(e) => setKeys({ ...keys, key: e.target.value })} />
                <input className="sm-input" aria-label="Client secret" type="password" placeholder="Client secret" value={keys.secret} onChange={(e) => setKeys({ ...keys, secret: e.target.value })} />
                <Button variant="primary" disabled={busy || !keys.key.trim() || !keys.secret.trim()} onClick={() => void run(async () => { await api()!.saveCreds(platform, keys.key, keys.secret); setKeys({ key: '', secret: '' }); return null })}>Speichern</Button>
              </>
            ) : (
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <span className="sm-tag">{plat.connected ? `Verbunden${plat.account ? ` · ${plat.account}` : ''}` : 'Nicht verbunden'}</span>
                {plat.connected
                  ? <Button variant="secondary" disabled={busy} onClick={() => void run(async () => { await api()!.disconnect(platform); return null })}><Unlink size={14} /> Trennen</Button>
                  : <Button variant="primary" disabled={busy} onClick={() => void run(() => api()!.connect(platform))}><Link2 size={14} /> Verbinden</Button>}
                {plat.message && <small>{plat.message}</small>}
                <small style={{ marginLeft: 'auto' }}>{drafts} von {DRAFT_LIMIT} Entwürfen (24 h)</small>
              </div>
            )}
          </div>
        )}

        {sel ? (
          <>
            <textarea className="sm-input" rows={4} aria-label="Bildunterschrift" placeholder="Bildunterschrift" value={caption} onChange={(e) => setCaption(e.target.value)} />
            <input className="sm-input" aria-label="Hashtags" placeholder="Hashtags, mit Leerzeichen getrennt" value={tags} onChange={(e) => setTags(e.target.value)} />
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Button variant="secondary" disabled={busy} onClick={() => void pick(sel)}><Sparkles size={14} /> Neuer Vorschlag</Button>
              <Button variant="secondary" onClick={() => void copy()}>{copied ? <Check size={14} /> : <Copy size={14} />} Kopieren</Button>
              <Button variant="primary" disabled={busy || !plat?.connected || !caption.trim()} onClick={() => { setMsg(''); setReview(true) }}>Prüfen und senden</Button>
            </div>

            {review && (
              <div style={{ display: 'grid', gap: 8, padding: 14, borderRadius: 16, background: 'rgba(0,0,0,0.25)' }}>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <span className="sm-tag">{sel.title}</span>
                  <span className="sm-tag">{mmss(sel.durationSec)}</span>
                  <span className="sm-tag">{plat?.account ?? 'TikTok'}</span>
                </div>
                <pre style={{ margin: 0, whiteSpace: 'pre-wrap', font: 'inherit', color: 'var(--text-2)' }}>{fullText}</pre>
                <small>Wird in der TikTok-App fertig gepostet. Text und Hashtags liegen nach dem Senden in der Zwischenablage. Falls das Video KI-generierte Inhalte zeigt, in TikTok die Kennzeichnung setzen.</small>
                <div style={{ display: 'flex', gap: 8 }}>
                  <Button variant="primary" disabled={busy} onClick={() => void send()}>Senden</Button>
                  <Button variant="secondary" onClick={() => setReview(false)}>Abbrechen</Button>
                </div>
              </div>
            )}

            {msg && <small role="alert" style={{ color: 'var(--warn)' }}>{msg}</small>}

            {jobs.map((j) => (
              <div key={j.id} style={{ display: 'grid', gap: 6 }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <span className="sm-tag">{LABEL[j.state]}</span>
                  <small style={{ flex: 1, color: j.state === 'fehler' ? 'var(--warn)' : undefined }}>{j.message}</small>
                  {j.state === 'fehler' && <Button variant="secondary" disabled={busy} onClick={() => void send(j.id)}>Erneut versuchen</Button>}
                </div>
                {(j.state === 'laedt' || j.state === 'wartend') && <div className="sm-bar" aria-hidden><i style={{ width: `${Math.max(j.progress, 0.02) * 100}%`, transition: 'width 0.4s' }} /></div>}
              </div>
            ))}
          </>
        ) : <small>Clip links wählen.</small>}
      </section>
    </div>
  )
}
