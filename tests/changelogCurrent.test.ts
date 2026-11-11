import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { changelogSection, parseNotes } from '../src/shared/releaseNotes'

// Die App zeigt die Notizen der installierten Version („Neu in Version …“, Einstellungen → Patch Notes) aus dem Changelog:
// ohne Abschnitt für die aktuelle Version wäre die Anzeige leer.
describe('Patch Notes der aktuellen Version', () => {
  const version = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version
  const changelog = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8')

  it('der Changelog hat einen Abschnitt mit Einträgen für die Version aus package.json', () => {
    const blocks = parseNotes(changelogSection(changelog, version))
    expect(blocks.length).toBeGreaterThan(0)
    expect(blocks.flatMap((b) => b.items).length).toBeGreaterThan(0)
  })
  it('Abschnitte heißen Added/Changed/Fixed (die App übersetzt sie)', () => {
    for (const b of parseNotes(changelogSection(changelog, version))) expect(['Added', 'Changed', 'Fixed', 'Removed']).toContain(b.heading)
  })
})
