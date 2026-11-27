import { describe, expect, it } from 'vitest'
import { preferenceHint } from '../src/shared/learnPrefs'
import type { Rating } from '../src/shared/learn'

const r = (level: Rating['level'], ...reasons: string[]): Rating => ({ level, reasons, at: '' })

describe('Vorlieben aus Bewertungen', () => {
  it('leer bei zu wenigen Nennungen', () => {
    expect(preferenceHint([r('strong', 'Lustig'), r('bad', 'Langweilig')])).toBe('')
  })
  it('häufige Gründe, Mängel nur aus mittel/schlecht, Editor-Gründe ignoriert', () => {
    const h = preferenceHint([
      ...Array(4).fill(r('strong', 'Lustig')), ...Array(3).fill(r('strong', 'Emotional')),
      ...Array(3).fill(r('bad', 'Ende abgeschnitten')), ...Array(5).fill(r('mid', 'Untertitel-Fehler')), r('strong', 'Hilfreich')
    ])
    expect(h).toContain('lustige Momente, emotionale Momente')
    expect(h).not.toContain('hilfreich')
    expect(h).toContain('ein abgeschnittenes Ende')
    expect(h).not.toContain('Untertitel')
  })
})
