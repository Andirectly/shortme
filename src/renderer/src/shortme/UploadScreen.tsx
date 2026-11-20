import { useCallback, useEffect, useMemo, useState } from 'react'
import { Upload, Link2, Unlink, Copy, Check, Sparkles, FolderOpen, Search, Send } from 'lucide-react'
import { DRAFT_LIMIT, type ExportRecord, type PlatformId, type UploadJob, type UploadOverview } from '@shared/upload'
import { Button, Pill } from './ui'
import { useProject } from './projectStore'

const api = (): Window['cutawan']['shortme']['upload'] | null => (typeof window !== 'undefined' ? window.cutawan?.shortme?.upload ?? null : null)
const errText = (e: unknown): string => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e))
const mmss = (s: number): string => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`
const day = (iso: string): string => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }) }
const LABEL: Record<UploadJob['state'], string> = { wartend: 'Wartet', laedt: 'Lädt hoch', entwurf: 'Entwurf gesendet', fehler: 'Fehler' }
type StatusFilter = 'alle' | 'neu' | 'gesendet' | 'fehler'
const STATUS_LABEL: Record<StatusFilter, string> = { alle: 'Alle', neu: 'Noch nicht gesendet', gesendet: 'Gesendet', fehler: 'Fehler' }

/**
 * Exporte & Upload: links Projekt wählen, filtern und Clips auswählen (einzeln oder mehrere), rechts Vorschau, Plattform,
 * Bildunterschrift und Senden. Mehrere Clips werden nacheinander mit je eigenem Textvorschlag als Entwurf gesendet.
 */
export function UploadScreen(): React.JSX.Element {
  const [ov, setOv] = useState<UploadOverview | null>(null)
  const projects = useProject((s) => s.projects)
  const [project, setProject] = useState<string>('alle')
  const [status, setStatus] = useState<StatusFilter>('alle')
  const [q, setQ] = useState('')
  const [selId, setSelId] = useState<string | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [platform, setPlatform] = useState<PlatformId>('tiktok')
  const [caption, setCaption] = useState('')
  const [tags, setTags] = useState('')
  const [keys, setKeys] = useState({ key: '', secret: '' })
  const [review, setReview] = useState(false)
  const [editKeys, setEditKeys] = useState(false)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [batch, setBatch] = useState<{ done: number; total: number } | null>(null)

  const refresh = useCallback(async () => { const a = api(); if (a) setOv(await a.overview().catch(() => null)) }, [])
  useEffect(() => { const a = api(); if (!a) return; const load = (): void => void a.overview().then(setOv).catch(() => undefined); load(); return a.onChanged(load) }, [])

  const exports = useMemo(() => [...(ov?.exports ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [ov])
  const lastJob = (id: string): UploadJob | undefined => (ov?.jobs ?? []).filter((j) => j.exportId === id)[0]
  const stateOf = (id: string): StatusFilter => { const j = lastJob(id); return !j ? 'neu' : j.state === 'fehler' ? 'fehler' : 'gesendet' }
  const titleOf = (hash: string): string => projects.find((p) => p.hash === hash)?.title ?? 'Unbekanntes Projekt'
  const byProject = useMemo(() => { const m = new Map<string, number>(); for (const e of exports) m.set(e.hash, (m.get(e.hash) ?? 0) + 1); return m }, [exports])
  const shown = exports.filter((e) => (project === 'alle' || e.hash === project) && (status === 'alle' || stateOf(e.id) === status) && (!q.trim() || `${e.title} ${e.hookText}`.toLowerCase().includes(q.trim().toLowerCase())))
  const groups = project === 'alle' ? [...new Set(shown.map((e) => e.hash))].map((h) => ({ hash: h, items: shown.filter((e) => e.hash === h) })) : [{ hash: project, items: shown }]

  const sel = useMemo<ExportRecord | null>(() => exports.find((e) => e.id === selId) ?? null, [exports, selId])
  const plat = ov?.platforms.find((p) => p.id === platform)
  const jobs = (ov?.jobs ?? []).filter((j) => j.exportId === sel?.id)
  const drafts = ov?.drafts[platform] ?? 0
  const join = (c: string, t: string): string => [c.trim(), t.trim().split(/\s+/).filter(Boolean).map((x) => `#${x.replace(/^#/, '')}`).join(' ')].filter(Boolean).join('\n\n')
  const fullText = join(caption, tags)

  const pick = async (e: ExportRecord): Promise<void> => {
    setSelId(e.id); setReview(false); setMsg(''); setCaption(e.hookText || e.title); setTags('')
    const a = api(); if (!a) return
    setBusy(true)
    try { const s = await a.suggest(e.id); setCaption(s.caption); setTags(s.hashtags.join(' ')) } catch (err) { setMsg(`Vorschlag nicht möglich: ${errText(err)}`) }
    setBusy(false)
  }
  const toggle = (id: string): void => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const run = async (fn: () => Promise<string | null | void>): Promise<void> => { setBusy(true); setMsg(''); try { const r = await fn(); if (r) setMsg(r) } catch (e) { setMsg(errText(e)) } setBusy(false); void refresh() }
  const send = (resume?: string): Promise<void> => run(async () => { const r = await api()!.send(sel!.id, platform, fullText, resume); if (!r) setReview(false); return r })
  /** Mehrere Clips: je Clip eigener Textvorschlag, nacheinander senden; bricht beim ersten Fehler ab (z. B. Entwurfsgrenze). */
  const sendMany = (): Promise<void> => run(async () => {
    const ids = exports.filter((e) => picked.has(e.id)).map((e) => e.id)
    setBatch({ done: 0, total: ids.length })
    try {
      for (const [i, id] of ids.entries()) {
        const s = await api()!.suggest(id).catch(() => null)
        const e = exports.find((x) => x.id === id)!
        const r = await api()!.send(id, platform, join(s?.caption ?? (e.hookText || e.title), (s?.hashtags ?? []).join(' ')))
        if (r) return `${e.title}: ${r}`
        setBatch({ done: i + 1, total: ids.length })
      }
      setPicked(new Set())
      return null
    } finally { setBatch(null) }
  })
  const copy = async (): Promise<void> => { await navigator.clipboard.writeText(fullText); setCopied(true); setTimeout(() => setCopied(false), 1500) }
  const sentCount = exports.filter((e) => stateOf(e.id) === 'gesendet').length

  const platformBar = (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {ov?.platforms.map((p) => <Pill key={p.id} pressed={p.id === platform} disabled={!p.available} onClick={() => setPlatform(p.id)} title={p.available ? undefined : 'Noch nicht verfügbar'}>{p.name}</Pill>)}
      </div>
      {plat?.available && (plat.needsSetup || editKeys ? (
        <div style={{ display: 'grid', gap: 8 }}>
          <small>Einmalig: Client key und Client secret aus dem TikTok-Entwicklerportal (Sandbox). Anleitung: docs/UPLOAD-SETUP.md</small>
          <input className="sm-input" aria-label="Client key" placeholder="Client key" value={keys.key} onChange={(e) => setKeys({ ...keys, key: e.target.value })} />
          <input className="sm-input" aria-label="Client secret" type="password" placeholder="Client secret" value={keys.secret} onChange={(e) => setKeys({ ...keys, secret: e.target.value })} />
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="primary" disabled={busy || !keys.key.trim() || !keys.secret.trim()} onClick={() => void run(async () => { await api()!.saveCreds(platform, keys.key, keys.secret); setKeys({ key: '', secret: '' }); setEditKeys(false); return null })}>Speichern</Button>
            {editKeys && <Button variant="secondary" onClick={() => setEditKeys(false)}>Abbrechen</Button>}
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="sm-tag">{plat.connected ? `Verbunden${plat.account ? ` · ${plat.account}` : ''}` : 'Nicht verbunden'}</span>
          {plat.connected
            ? <Button variant="ghost" disabled={busy} onClick={() => void run(async () => { await api()!.disconnect(platform); return null })}><Unlink size={14} /> Trennen</Button>
            : <Button variant="primary" disabled={busy} onClick={() => void run(() => api()!.connect(platform))}><Link2 size={14} /> Verbinden</Button>}
          <Button variant="ghost" disabled={busy} onClick={() => setEditKeys(true)}>Zugangsdaten</Button>
          <small style={{ marginLeft: 'auto' }}>{drafts} von {DRAFT_LIMIT} Entwürfen (24 h)</small>
        </div>
      ))}
      {plat?.message && <small>{plat.message}</small>}
    </div>
  )

  return (
    <div style={{ display: 'grid', gap: 16, paddingTop: 12 }}>
      <div style={{ display: 'flex', alignItems: 'end', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ display: 'flex', gap: 10, alignItems: 'center' }}><Upload size={26} /> Exporte &amp; Upload</h1>
          <small>{exports.length} exportierte Clips aus {byProject.size} Projekten · {sentCount} gesendet</small>
        </div>
        <div style={{ position: 'relative' }}>
          <Search size={14} aria-hidden style={{ position: 'absolute', left: 12, top: '50%', translate: '0 -50%', color: 'var(--text-3)' }} />
          <input className="sm-input" aria-label="Clips durchsuchen" placeholder="Titel suchen" value={q} onChange={(e) => setQ(e.target.value)} style={{ paddingLeft: 32, width: 220 }} />
        </div>
      </div>

      <div role="group" aria-label="Projekt" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <Pill pressed={project === 'alle'} onClick={() => setProject('alle')}>Alle Projekte ({exports.length})</Pill>
        {[...byProject.entries()].map(([h, n]) => <Pill key={h} pressed={project === h} onClick={() => setProject(h)} title={titleOf(h)}><span style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block', verticalAlign: 'bottom' }}>{titleOf(h)}</span> ({n})</Pill>)}
      </div>
      <div role="group" aria-label="Status" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {(Object.keys(STATUS_LABEL) as StatusFilter[]).map((s) => <Pill key={s} pressed={status === s} onClick={() => setStatus(s)}>{STATUS_LABEL[s]}</Pill>)}
        <span style={{ flex: 1 }} />
        {shown.length > 0 && <Button variant="ghost" onClick={() => setPicked(picked.size === shown.length ? new Set() : new Set(shown.map((e) => e.id)))}>{picked.size === shown.length ? 'Auswahl aufheben' : 'Alle auswählen'}</Button>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) clamp(320px, 30vw, 440px)', gap: 18, alignItems: 'start' }}>
        <div style={{ display: 'grid', gap: 18, minWidth: 0 }}>
          {ov && exports.length === 0 && <div className="sm-glass" style={{ padding: 22 }}><small>Noch nichts exportiert. Im Editor oder in der Clipliste „Exportieren“ – die Clips erscheinen dann hier.</small></div>}
          {exports.length > 0 && shown.length === 0 && <div className="sm-glass" style={{ padding: 22 }}><small>Keine Clips in dieser Auswahl.</small></div>}
          {groups.map((g) => (
            <section key={g.hash} style={{ display: 'grid', gap: 10 }}>
              {project === 'alle' && <h3 style={{ fontSize: 14, color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{titleOf(g.hash)}</h3>}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12 }}>
                {g.items.map((e) => { const j = lastJob(e.id); const on = picked.has(e.id); return (
                  <div key={e.id} className="sm-card" onClick={() => void pick(e)} style={{ position: 'relative', cursor: 'pointer', outline: e.id === selId ? '2px solid rgba(255,255,255,0.75)' : on ? '2px solid var(--accent)' : 'none' }}>
                    <video src={window.cutawan.mediaUrl(e.path)} preload="metadata" muted style={{ width: '100%', aspectRatio: '9/16', objectFit: 'cover', display: 'block', borderRadius: 'var(--r-card) var(--r-card) 0 0', background: '#000' }} />
                    <button aria-label="Auswählen" aria-pressed={on} onClick={(ev) => { ev.stopPropagation(); toggle(e.id) }} style={{ position: 'absolute', top: 8, right: 8, width: 24, height: 24, borderRadius: '50%', border: '1.5px solid #fff', background: on ? 'var(--accent)' : 'rgba(0,0,0,0.35)', display: 'grid', placeItems: 'center' }}>{on && <Check size={14} />}</button>
                    {j && <span className="sm-tag" style={{ position: 'absolute', top: 8, left: 8, background: j.state === 'fehler' ? 'rgba(160,40,40,0.85)' : 'rgba(0,0,0,0.6)' }}>{LABEL[j.state]}</span>}
                    <div style={{ padding: '8px 10px 10px', display: 'grid', gap: 2 }}>
                      <strong style={{ fontSize: 13, lineHeight: 1.25, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{e.title}</strong>
                      <small>{mmss(e.durationSec)} · {day(e.createdAt)}</small>
                    </div>
                  </div>
                ) })}
              </div>
            </section>
          ))}
        </div>

        <aside className="sm-glass" aria-label="Senden" style={{ position: 'sticky', top: 12, maxHeight: 'calc(100vh - 90px)', overflowY: 'auto', overflowWrap: 'anywhere', padding: 16, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 14, alignContent: 'start', background: 'rgba(24,24,32,0.72)' }}>
          {picked.size > 1 ? (
            <>
              <h2 style={{ fontSize: 18 }}>{picked.size} Clips ausgewählt</h2>
              <small>Jeder Clip bekommt seinen eigenen Text- und Hashtag-Vorschlag und wird nacheinander als Entwurf gesendet.</small>
              {platformBar}
              {picked.size + drafts > DRAFT_LIMIT && <small style={{ color: 'var(--warn)' }}>Mehr als {DRAFT_LIMIT - drafts} freie Entwürfe in 24 h – der Rest scheitert an der Grenze der Plattform.</small>}
              <Button variant="primary" disabled={busy || !plat?.connected} onClick={() => void sendMany()}><Send size={14} /> {batch ? `Sende ${batch.done + 1} von ${batch.total} …` : `${picked.size} Clips senden`}</Button>
              <Button variant="ghost" onClick={() => setPicked(new Set())}>Auswahl aufheben</Button>
              {msg && <small role="alert" style={{ color: 'var(--warn)' }}>{msg}</small>}
            </>
          ) : sel ? (
            <>
              <video key={sel.id} src={window.cutawan.mediaUrl(sel.path)} controls preload="metadata" style={{ justifySelf: 'center', height: 'min(42vh, 400px)', aspectRatio: '9/16', borderRadius: 14, background: '#000' }} />
              <div style={{ display: 'grid', gap: 4 }}>
                <h2 style={{ fontSize: 18, lineHeight: 1.25 }}>{sel.title}</h2>
                <small>{mmss(sel.durationSec)} · exportiert {day(sel.createdAt)} · {titleOf(sel.hash)}</small>
                <Button variant="ghost" style={{ justifySelf: 'start', paddingLeft: 0 }} onClick={() => void window.cutawan.showItemInFolder(sel.path)}><FolderOpen size={14} /> Im Ordner zeigen</Button>
              </div>
              {platformBar}
              <textarea className="sm-input" rows={4} aria-label="Bildunterschrift" placeholder="Bildunterschrift" value={caption} onChange={(e) => setCaption(e.target.value)} />
              <input className="sm-input" aria-label="Hashtags" placeholder="Hashtags, mit Leerzeichen getrennt" value={tags} onChange={(e) => setTags(e.target.value)} />
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Button variant="secondary" disabled={busy} onClick={() => void pick(sel)}><Sparkles size={14} /> Neuer Vorschlag</Button>
                <Button variant="secondary" onClick={() => void copy()}>{copied ? <Check size={14} /> : <Copy size={14} />} Kopieren</Button>
                <Button variant="primary" disabled={busy || !plat?.connected || !caption.trim()} onClick={() => { setMsg(''); setReview(true) }}>Prüfen und senden</Button>
              </div>
              {review && (
                <div style={{ display: 'grid', gap: 8, padding: 14, borderRadius: 16, background: 'rgba(0,0,0,0.25)' }}>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><span className="sm-tag">{mmss(sel.durationSec)}</span><span className="sm-tag">{plat?.account ?? plat?.name ?? 'TikTok'}</span></div>
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
          ) : (
            <>
              <h2 style={{ fontSize: 18 }}>Clip wählen</h2>
              <small>Klick auf einen Clip zeigt ihn hier mit Text und Senden. Über die Kreise wählst du mehrere Clips auf einmal.</small>
              {platformBar}
            </>
          )}
        </aside>
      </div>
    </div>
  )
}
