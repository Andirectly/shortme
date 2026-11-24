/**
 * SSRF-Schutz für Remote-URL-Jobs (Plan V3, Kap. 6/14): nur http(s), keine Zugangsdaten in der URL,
 * keine Loopback-/privaten/Link-Local-Ziele. Jede Redirect-Stufe erneut prüfen (`checkUrl` pro Hop).
 * Gegen DNS-Rebinding: die geprüften Adressen an den Download weitergeben bzw. kurz vor dem Download erneut prüfen.
 */
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

export class UrlBlocked extends Error {
  readonly code = 'URL_BLOCKED'
}

/** true = Adresse liegt in einem nicht öffentlichen Netz. */
export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip)
  if (v === 4) {
    const [a, b] = ip.split('.').map(Number)
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224
  }
  if (v === 6) {
    const s = ip.toLowerCase()
    const mapped = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
    if (mapped) return isPrivateAddress(mapped[1])
    return s === '::' || s === '::1' || s.startsWith('fc') || s.startsWith('fd') || /^fe[89ab]/.test(s) || s.startsWith('ff')
  }
  return true
}

type Resolver = (host: string) => Promise<Array<{ address: string }>>
const defaultResolver: Resolver = (host) => lookup(host, { all: true, verbatim: true })

/** Prüft eine URL; gibt die aufgelösten öffentlichen Adressen zurück oder wirft `UrlBlocked`. */
export async function checkUrl(raw: string, resolve: Resolver = defaultResolver): Promise<{ url: URL; addresses: string[] }> {
  let url: URL
  try { url = new URL(raw) } catch { throw new UrlBlocked('Ungültige URL') }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new UrlBlocked(`Schema ${url.protocol} nicht erlaubt`)
  if (url.username || url.password) throw new UrlBlocked('Zugangsdaten in der URL nicht erlaubt')
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal'))
    throw new UrlBlocked('Lokaler Host nicht erlaubt')
  const addresses = isIP(host) ? [host] : (await resolve(host).catch(() => [])).map((a) => a.address)
  if (addresses.length === 0) throw new UrlBlocked('Host nicht auflösbar')
  const bad = addresses.find(isPrivateAddress)
  if (bad) throw new UrlBlocked(`Ziel ${bad} liegt in einem privaten Netz`)
  return { url, addresses }
}
