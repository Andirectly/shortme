import { describe, expect, it } from 'vitest'
import { ffmpegErrorLines } from '../src/main/pipeline/ffmpeg'

describe('FFmpeg-Fehlerzeilen nach vorn', () => {
  it('nimmt die echte Fehlerzeile, nicht die Stream-Infos', () => {
    const err = [
      "Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'x.mp4':",
      '  Duration: 06:27:50.06, start: 0.000000, bitrate: 7549 kb/s',
      '  Stream #0:0[0x1](und): Audio: aac (LC), 48000 Hz, stereo, fltp, 158 kb/s (default)',
      '[image2 @ 0000] Could not find codec parameters for stream 0 (Video: png): unspecified size',
      'C:\\t\\title\\%05d.png: Invalid data found when processing input'
    ].join('\r\n')
    const r = ffmpegErrorLines(err)
    expect(r).toContain('Invalid data found when processing input')
    expect(r).toContain('Could not find codec parameters')
    expect(r).not.toContain('Duration')
  })
  it('ohne erkennbare Fehlerzeile: letzte Zeilen', () => {
    expect(ffmpegErrorLines('a\nb\nc')).toBe('b | c')
  })
})
