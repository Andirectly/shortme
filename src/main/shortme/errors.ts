/** Verständliche Fehlermeldungen (Deutsch) statt Rohtexten; Details bleiben im Log (`logs/shortme.log`). */
export function friendlyError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e)
  const code = (e as NodeJS.ErrnoException | undefined)?.code
  const rules: Array<[RegExp | string, string]> = [
    ['ENOSPC', 'Der Speicher ist voll. Bitte Platz schaffen und erneut versuchen – bereits fertige Schritte bleiben erhalten.'],
    ['EACCES', 'Kein Zugriff auf Datei oder Ordner. Bitte Berechtigungen prüfen oder einen anderen Zielordner wählen.'],
    ['EPERM', 'Windows hat den Dateizugriff blockiert (Virenscanner?). Bitte erneut versuchen.'],
    ['ENOENT', 'Eine Datei wurde nicht gefunden – vielleicht wurde das Quellvideo verschoben oder gelöscht.'],
    [/Node-Laufzeit fehlt/, 'Die Node-Laufzeit für die Spracherkennung fehlt. Bitte unter „Modelle“ installieren (Einrichtung erneut ausführen).'],
    [/Transkript fehlt/, 'Das Transkript fehlt. Bitte das Video zuerst transkribieren.'],
    [/llama-server beendet|llama-server startet nicht/, 'Das Sprachmodell konnte nicht gestartet werden (VRAM voll oder Treiber zu alt?). Andere GPU-Programme schließen oder im Systemcheck prüfen.'],
    [/out of memory|cudaMalloc|CUDA error/i, 'Dem Grafikspeicher ging der Platz aus. Andere GPU-Programme schließen oder ein kleineres Modell wählen (Modelle → Kompakt).'],
    [/SHA-256/, 'Die heruntergeladene Datei ist beschädigt (Prüfsumme falsch). Der Download wurde verworfen – bitte erneut laden.'],
    [/HTTP 4\d\d|HTTP 5\d\d|fetch failed|ENOTFOUND|ECONNRESET|ETIMEDOUT/i, 'Netzwerkfehler beim Laden. Bitte Verbindung prüfen; Downloads setzen beim nächsten Versuch fort.'],
    [/Abgebrochen/, 'Abgebrochen.'],
    [/Video unavailable|Private video|Sign in to confirm/i, 'Der Link ist nicht abrufbar (privat, gesperrt oder Anmeldung nötig).'],
    [/ffmpeg exited/i, 'FFmpeg hat die Verarbeitung abgebrochen. Die Videodatei ist evtl. beschädigt oder nutzt ein ungewöhnliches Format.']
  ]
  for (const [k, msg] of rules) {
    if (typeof k === 'string' ? code === k || raw.includes(k) : k.test(raw)) return msg
  }
  return raw.length > 240 ? `${raw.slice(0, 240)} …` : raw
}
