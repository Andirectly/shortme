import { describe, expect, it } from 'vitest'
import { lastMinutesRange, parseHms, parseTwitchUrl, sectionArg } from '../src/shared/twitch'
import { overlapsSilence, parseSilence } from '../src/main/twitch/silence'
import { CHAT_LAG_SEC, chatSignal, isLaugh, parseChatJson } from '../src/main/twitch/chat'
import { parsePrivmsg } from '../src/main/twitch/liveChat'
import { chatBonus } from '../src/main/shortme/clips/heat'
import { twitchErrorMessage } from '../src/main/twitch/import'

describe('Twitch-Links', () => {
  it('erkennt VOD, Clip und Kanal', () => {
    expect(parseTwitchUrl('https://www.twitch.tv/videos/2904126643')).toEqual({ kind: 'vod', id: '2904126643' })
    expect(parseTwitchUrl('twitch.tv/videos/123?t=1h')).toEqual({ kind: 'vod', id: '123' })
    expect(parseTwitchUrl('https://clips.twitch.tv/FunnySlug-abc')).toEqual({ kind: 'clip', slug: 'FunnySlug-abc' })
    expect(parseTwitchUrl('https://www.twitch.tv/papaplatte/clip/Slug123')).toEqual({ kind: 'clip', slug: 'Slug123', channel: 'papaplatte' })
    expect(parseTwitchUrl('https://m.twitch.tv/PapaPlatte')).toEqual({ kind: 'channel', channel: 'papaplatte' })
    expect(parseTwitchUrl('https://www.twitch.tv/directory')).toBeNull()
    expect(parseTwitchUrl('https://youtube.com/watch?v=x')).toBeNull()
    expect(parseTwitchUrl('kein link')).toBeNull()
  })
  it('Zeitbereich der letzten Minuten', () => {
    expect(lastMinutesRange(30402, 3)).toEqual([30222, 30402])
    expect(lastMinutesRange(100, 10)).toEqual([0, 100])
    expect(sectionArg([10, 70])).toBe('*10-70')
    expect(parseHms('1:30:00')).toBe(5400)
    expect(parseHms('90')).toBe(90)
    expect(parseHms('x')).toBeNaN()
  })
  it('Fehlermeldungen sind verständlich', () => {
    expect(twitchErrorMessage('ERROR: This video is only available for subscribers', false)).toMatch(/Abonnenten.*Token/)
    expect(twitchErrorMessage('ERROR: HTTP Error 404: Not Found', false)).toMatch(/7–60 Tagen/)
    expect(twitchErrorMessage('ERROR: [twitch:stream] x: The channel is not currently live', false)).toMatch(/offline/)
  })
})

describe('Stumme Abschnitte', () => {
  const log = '[silencedetect @ 0x1] silence_start: 10.5\n[silencedetect @ 0x1] silence_end: 70.25 | silence_duration: 59.75\n[silencedetect @ 0x1] silence_start: 100\n[silencedetect @ 0x1] silence_end: 105 | silence_duration: 5\n[silencedetect @ 0x1] silence_start: 190'
  it('liest Paare, filtert kurze, schließt offenes Ende', () => {
    expect(parseSilence(log, 220, 20)).toEqual([[10.5, 70.3], [190, 220]])
  })
  it('Überlappung', () => {
    expect(overlapsSilence([[10, 70]], 0, 30)).toBe(true)
    expect(overlapsSilence([[10, 70]], 80, 120)).toBe(false)
    expect(overlapsSilence([[10, 12]], 0, 30)).toBe(false)
  })
})

describe('Chat-Signal', () => {
  it('erkennt Lach-Emotes', () => {
    for (const t of ['LUL', 'KEKW', 'OMEGALUL', 'ICANT', 'haha das war gut LUL', '😂']) expect(isLaugh(t), t).toBe(true)
    for (const t of ['hallo', 'was für ein Spiel', 'LULU']) expect(isLaugh(t), t).toBe(false)
  })
  it('Rate um 15 s nach vorne verschoben, normalisiert, Lach-Salve zurückgerechnet', () => {
    const msgs = [] as Array<{ t: number; text: string }>
    for (let t = 0; t < 120; t++) msgs.push({ t, text: 'hi' }) // 1 Nachricht/s Grundrauschen
    for (let k = 0; k < 40; k++) msgs.push({ t: 60 + (k % 8), text: 'KEKW' }) // Salve bei 60–67 s
    const s = chatSignal(msgs, 100)
    expect(s.messages).toBe(160)
    const at = (e: number): number => s.heat[e].value
    expect(at(60 - CHAT_LAG_SEC + 2)).toBeGreaterThan(0.9) // Ereignis bei 47 s hat die Reaktion bei 62 s
    expect(at(10)).toBeLessThan(0.5)
    expect(Math.max(...s.heat.map((h) => h.value))).toBeLessThanOrEqual(1)
    expect(s.laughs.length).toBeGreaterThanOrEqual(1)
    expect(s.laughs[0].kind).toBe('chat')
    expect(s.laughs[0].start).toBeGreaterThanOrEqual(40)
    expect(s.laughs[0].start).toBeLessThanOrEqual(55)
  })
  it('TwitchDownloader-JSON und IRC-Zeilen', () => {
    expect(parseChatJson({ comments: [{ content_offset_seconds: 105, message: { body: 'LUL' } }] }, 100)).toEqual([{ t: 5, text: 'LUL' }])
    expect(parsePrivmsg('@badge-info=;color=#fff :user!user@user.tmi.twitch.tv PRIVMSG #papaplatte :KEKW hallo')).toBe('KEKW hallo')
    expect(parsePrivmsg(':tmi.twitch.tv 001 justinfan1 :Welcome')).toBeNull()
  })
  it('Bonus: stärker als die Wiedergabekurve, nach oben/unten begrenzt', () => {
    expect(chatBonus(1)).toBe(24)
    expect(chatBonus(0)).toBe(-10)
    expect(chatBonus(0.3)).toBe(0)
  })
})
