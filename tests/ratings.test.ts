import { describe, expect, it } from 'vitest'
import { fromThumbs, sanitizeRating } from '../src/shared/learn'

describe('Bewertung', () => {
  it('übernimmt alte Daumen', () => {
    expect(fromThumbs({ a: 1, b: -1, c: 0 })).toEqual({ a: { level: 'strong', reasons: [], at: '' }, b: { level: 'bad', reasons: [], at: '' } })
  })
  it('verwirft fremde Gründe und Stufen', () => {
    expect(sanitizeRating({ level: 'mid', reasons: ['Langweilig', 'Lustig', 5], at: 'x' })?.reasons).toEqual(['Langweilig'])
    expect(sanitizeRating({ level: 'x' })).toBeNull()
  })
})
