import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { alternativesOk, effectiveStatus, modelsMarkdown } from '../src/main/testlab/registry'
import type { CatalogModel } from '../src/shared/models'

const cat = JSON.parse(readFileSync('resources/models-catalog.json', 'utf8')) as { slots: Array<{ id: string; name: string }>; models: CatalogModel[] }

describe('Modell-Plätze', () => {
  it('jeder Platz hat genau ein aktives Modell im Katalog', () => {
    for (const s of cat.slots) {
      const act = cat.models.filter((m) => m.slot === s.id && m.status === 'aktiv')
      if (s.id !== 'emotion') expect(act.length, s.id).toBe(1)
    }
  })
  it('höchstens zwei integrierte Alternativen je Platz', () => {
    for (const s of cat.slots) expect(alternativesOk(cat.models, s.id, cat.models.find((m) => m.slot === s.id && m.status === 'aktiv')?.id ?? ''), s.id).toBe(true)
  })
  it('neben den aktiven Modellen sind nur SCRFD-10G, BoT-SORT-ReID und Remotion integriert', () => {
    const extra = cat.models.filter((m) => m.integrated && m.status !== 'aktiv').map((m) => m.id)
    expect(extra.sort()).toEqual(['botsort_reid', 'remotion_renderer', 'scrfd_10g'])
  })
  it('wirksamer Status: Entscheidung > Zum Entfernen > Test > Kandidat', () => {
    const yunet = cat.models.find((m) => m.id === 'yunet')!, scrfd = cat.models.find((m) => m.id === 'scrfd_10g')!, k = cat.models.find((m) => m.id === 'scrfd_2_5g')!
    expect(effectiveStatus(yunet, {}, [], cat.models)).toBe('aktiv')
    expect(effectiveStatus(scrfd, {}, [], cat.models)).toBe('test')
    expect(effectiveStatus(k, {}, [], cat.models)).toBe('kandidat')
    expect(effectiveStatus(scrfd, { face: 'scrfd_10g' }, ['yunet'], cat.models)).toBe('aktiv')
    expect(effectiveStatus(yunet, { face: 'scrfd_10g' }, ['yunet'], cat.models)).toBe('entfernen')
  })
  it('MODELS.md listet je Modell Platz und Status', () => {
    const md = modelsMarkdown(cat, { active: { face: 'scrfd_10g' }, remove: ['yunet'], measured: {} })
    expect(md).toContain('## Gesichtserkennung')
    expect(md).toMatch(/\| YuNet \|[^|]*\| zum Entfernen \|/)
    expect(md).toMatch(/\| SCRFD-10G[^|]*\|[^|]*\| aktiv \|/)
  })
})
