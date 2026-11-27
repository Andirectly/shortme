// Gründe aus den Bewertungen → kurzer Hinweis für die KI-Rangfolge (rein, getestet).
// Nur Gründe, die die Auswahl betreffen; Bildausschnitt und Untertitel sind Sache des Editors, nicht der Auswahl.
import type { Rating } from './learn'

const LIKES: Record<string, string> = { 'Starker Hook': 'ein starker Einstieg', Lustig: 'lustige Momente', Emotional: 'emotionale Momente', Hilfreich: 'hilfreiche, lehrreiche Inhalte' }
const FLAWS: Record<string, string> = {
  'Hook schwach': 'ein schwacher Einstieg',
  'Anfang falsch': 'ein Anfang an der falschen Stelle',
  'Ende abgeschnitten': 'ein abgeschnittenes Ende',
  'Ohne Kontext unverständlich': 'Clips, die ohne Vorwissen unverständlich sind',
  Langweilig: 'langweilige Stellen'
}
/** Ab so vielen Nennungen eines Grundes zählt er (Bewertungen sollen schnell wirken). */
const MIN_COUNT = 2

function top(ratings: Rating[], map: Record<string, string>, levels: Rating['level'][]): string[] {
  const n = new Map<string, number>()
  for (const r of ratings) if (levels.includes(r.level)) for (const why of r.reasons) if (map[why]) n.set(why, (n.get(why) ?? 0) + 1)
  return [...n.entries()].filter(([, c]) => c >= MIN_COUNT).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([why]) => map[why])
}

export function preferenceHint(ratings: Rating[]): string {
  const likes = top(ratings, LIKES, ['strong'])
  const flaws = top(ratings, FLAWS, ['mid', 'bad'])
  const parts: string[] = []
  if (likes.length) parts.push(`Aus früheren Bewertungen: besonders gut ankommen ${likes.join(', ')} – solche Kandidaten bei sonst ähnlicher Qualität bevorzugen.`)
  if (flaws.length) parts.push(`Häufig bemängelt wurden ${flaws.join(', ')} – Kandidaten mit diesem Mangel nachrangig einordnen.`)
  return parts.join('\n')
}
