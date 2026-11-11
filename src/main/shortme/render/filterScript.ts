// FFmpeg liest einen langen Filtergraph aus einer Datei (Kommandozeile ist unter Windows auf ~32k Zeichen begrenzt):
// ab 6.1 mit `-/filter_complex <Datei>`, ältere Versionen (z. B. das gebündelte ffmpeg-static 6.0) nur mit `-filter_complex_script <Datei>`.
// Statt die Version zu raten, probieren wir die neue Schreibweise und weichen bei „Unrecognized option“ aus; das Ergebnis wird je Programm gemerkt.
const flags = new Map<string, string>()

export type Run = (bin: string, args: string[]) => Promise<unknown>

export async function runWithGraphFile(run: Run, bin: string, before: string[], script: string, after: string[]): Promise<void> {
  const known = flags.get(bin)
  for (const flag of known ? [known] : ['-/filter_complex', '-filter_complex_script']) {
    try { await run(bin, [...before, flag, script, ...after]); flags.set(bin, flag); return } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (known || flag !== '-/filter_complex' || !/Unrecognized option '\/filter_complex'/.test(msg)) throw e
    }
  }
}

/** Nur für Tests. */
export const resetGraphFlags = (): void => flags.clear()
