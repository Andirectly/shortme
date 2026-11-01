import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { dataRoot } from '../engines/paths'
import { writeFileAtomic } from '../shortme/atomic'

export interface LearnSettings {
  /** „Daten sammeln“: Korrektur-Protokoll, Kandidaten-Spur, Datensatz-Aufbau. */
  collect: boolean
  /** Werkbank: Videodatei nach der Auswertung löschen (Ton, Transkript, Schlüsselbilder, Datensatz bleiben). */
  deleteVideos: boolean
  /** Erweitert: Trend-Signal über öffentliche YouTube-Suchvorschläge (schwach). */
  trend: boolean
}
const DEFAULTS: LearnSettings = { collect: true, deleteVideos: true, trend: false }

export const datasetDir = (): string => join(dataRoot(), 'dataset')
export const learnFile = (name: string): string => join(dataRoot(), 'learn', name)

let cache: LearnSettings | null = null
export async function loadLearnSettings(): Promise<LearnSettings> {
  if (cache) return cache
  try { cache = { ...DEFAULTS, ...(JSON.parse(await readFile(learnFile('settings.json'), 'utf8')) as Partial<LearnSettings>) } } catch { cache = { ...DEFAULTS } }
  return cache
}
export async function saveLearnSettings(patch: Partial<LearnSettings>): Promise<LearnSettings> {
  cache = { ...(await loadLearnSettings()), ...patch }
  await writeFileAtomic(learnFile('settings.json'), JSON.stringify(cache, null, 1))
  return cache
}
export const collecting = async (): Promise<boolean> => (await loadLearnSettings()).collect

/** Vorgemerkte Aufgaben je Datei lesen (JSON; fehlt oder kaputt → Standard). */
export async function readJson<T>(path: string, fallback: T): Promise<T> {
  try { return JSON.parse(await readFile(path, 'utf8')) as T } catch { return fallback }
}

/** Änderungen an Lerndaten melden (Bewertung, Korrektur, Export, Werkbank); `learn/ipc.ts` hängt den verzögerten Neuaufbau des Datensatzes daran. */
let listener: () => void = () => undefined
export const onLearnChange = (fn: () => void): void => { listener = fn }
export const notifyLearnChange = (): void => listener()
