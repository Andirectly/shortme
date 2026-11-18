import { describe, expect, it } from 'vitest'
import { channelName } from '../src/shared/twitch'

describe('Twitch-Kanalname aus Eingabe', () => {
  it('Name, Link und Großschreibung', () => {
    expect(channelName('Papaplatte')).toBe('papaplatte')
    expect(channelName(' https://www.twitch.tv/trymacs/videos?x=1 ')).toBe('trymacs')
    expect(channelName('twitch.tv/lofigirl')).toBe('lofigirl')
  })
  it('ungültig', () => {
    expect(channelName('a')).toBeNull()
    expect(channelName('mit leerzeichen')).toBeNull()
    expect(channelName('')).toBeNull()
  })
})
