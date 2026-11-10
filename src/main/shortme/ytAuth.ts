// YouTube-Anmeldung für yt-dlp: gespeicherte Wahl aus den Einstellungen (Firefox oder cookies.txt).
import { cookieArgs, pluginArgs, type CookieAuthOptions } from '../pipeline/ytdlp'
import { getImportPreferences } from '../settings'

export function savedCookieOpts(): CookieAuthOptions {
  const p = getImportPreferences()
  return { cookiesFromBrowser: p.importCookiesBrowser || undefined, cookiesFile: p.importCookiesPath }
}

export function savedAuthArgs(): string[] {
  const o = savedCookieOpts()
  return [...pluginArgs(o), ...cookieArgs(o)]
}
