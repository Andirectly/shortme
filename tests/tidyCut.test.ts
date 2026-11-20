import { describe, expect, it } from 'vitest'
import { tidyCut } from '../src/shared/review'

describe('tidyCut: abgeschnittene Modelltexte enden auf ganzem Wort', () => {
  it('kürzt Wortreste und hängende Anführungszeichen', () => {
    expect(tidyCut('Die Tester sind enttäuscht, als sie feststellen, und müssen die verbliebenen Boxen nun hastig durchwü')).toBe('Die Tester sind enttäuscht, als sie feststellen, und müssen die verbliebenen Boxen nun hastig …')
    expect(tidyCut("standalone: fail – Der Clip ist nicht ohne Vorwissen verständlich. Die Referenz auf 'das gleiche Produkt' und die spezifische Bezeichnung '")).toBe("standalone: fail – Der Clip ist nicht ohne Vorwissen verständlich. Die Referenz auf 'das gleiche Produkt' und die spezifische Bezeichnung …")
  })
  it('lässt vollständige Sätze unverändert', () => {
    expect(tidyCut('Der Clip ist gut.')).toBe('Der Clip ist gut.')
    expect(tidyCut('')).toBe('')
  })
})

describe('tidyCut: vollständige Zeilen bleiben', () => {
  it('kurze Texte und Kennungen am Ende', () => {
    expect(tidyCut('Schnitt: bitte ansehen')).toBe('Schnitt: bitte ansehen')
    expect(tidyCut('Engine Mac · Suchwege audio+speech · LFM3 2 Pakete · Rang 1 · Ausgabe c77a12aea5b7 und noch etwas mehr Text')).toContain('und noch etwas mehr …')
    expect(tidyCut('Engine Mac · Suchwege audio+speech · LFM3 2 Pakete · Rang 1 · Ausgabe c77a12aea5b7 lang genug für die Grenze 12')).toMatch(/12$/)
  })
})
