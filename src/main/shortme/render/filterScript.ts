// Filtergraph an FFmpeg übergeben. Normale Graphen gehen direkt als `-filter_complex <Graph>` (versteht jede Version).
// Nur sehr lange Graphen (Kommandozeile unter Windows ~32k Zeichen) kommen aus einer Datei: ab 6.1 `-/filter_complex <Datei>`,
// ältere Versionen nur `-filter_complex_script <Datei>`. Statt die Version zu raten, probieren wir die neue Schreibweise und weichen bei
// „Option nicht gefunden“ aus; das Ergebnis wird je Programm gemerkt. (Auf einem Rechner mit älterem GPU-FFmpeg scheiterte der Export trotzdem
// an `-/filter_complex` – daher seit 0.36 der direkte Weg für alles, was in die Kommandozeile passt.)
const flags = new Map<string, string>()

export type Run = (bin: string, args: string[]) => Promise<unknown>

/** Graphen bis zu dieser Länge gehen direkt in die Kommandozeile (Rest der Argumente < 2k Zeichen). */
export const INLINE_MAX = 24_000

const unknownOption = (msg: string): boolean => /Unrecognized option '?\/?filter_complex|Option not found/i.test(msg)

export async function runWithGraphFile(run: Run, bin: string, before: string[], graph: string, script: string, after: string[]): Promise<void> {
  if (graph.length <= INLINE_MAX) { await run(bin, [...before, '-filter_complex', graph, ...after]); return }
  const known = flags.get(bin)
  for (const flag of known ? [known] : ['-/filter_complex', '-filter_complex_script']) {
    try { await run(bin, [...before, flag, script, ...after]); flags.set(bin, flag); return } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (known || flag !== '-/filter_complex' || !unknownOption(msg)) throw e
    }
  }
}

/** Nur für Tests. */
export const resetGraphFlags = (): void => flags.clear()
