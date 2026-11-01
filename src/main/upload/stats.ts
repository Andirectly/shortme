// Teil 3 (vorbereitet, nicht aktiviert): Aufrufzahlen geposteter Videos dem Shortme-Clip zuordnen.
import type { UploadJob } from '../../shared/upload'
import type { PlatformVideoStat } from './platform'

const norm = (s: string): string => s.toLowerCase().replace(/#\S+/g, '').replace(/\s+/g, ' ').trim()

/** Zuordnung über die Bildunterschrift (wir kopieren sie in die Zwischenablage, der Text ist also derselbe) und den Zeitpunkt: Post nach dem Senden. */
export function matchStats(jobs: UploadJob[], stats: PlatformVideoStat[]): Array<{ job: UploadJob; stat: PlatformVideoStat }> {
  const out: Array<{ job: UploadJob; stat: PlatformVideoStat }> = []
  for (const job of jobs.filter((j) => j.state === 'entwurf')) {
    const c = norm(job.caption)
    const stat = c && stats.find((s) => s.createdAt >= Date.parse(job.createdAt) - 60_000 && norm(s.description) === c)
    if (stat) out.push({ job, stat })
  }
  return out
}
