import { describe, expect, it } from 'vitest'
import { isUnsupportedEngine } from '../src/shared/engine'

describe('Remote: angeforderte Engine', () => {
  it('fremde oder unbekannte Engine wird abgelehnt, ohne Angabe gilt der Standard', () => {
    expect(isUnsupportedEngine('engine4', 'darwin')).toBe(true)
    expect(isUnsupportedEngine('engine-mac', 'win32')).toBe(true)
    expect(isUnsupportedEngine('engine9', 'win32')).toBe(true)
    expect(isUnsupportedEngine('engine4', 'win32')).toBe(false)
    expect(isUnsupportedEngine(undefined, 'darwin')).toBe(false)
    expect(isUnsupportedEngine('default', 'darwin')).toBe(false)
  })
})
