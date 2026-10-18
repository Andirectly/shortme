// Chat-Mitschrift für den Live-Puffer (nur wenn „Twitch-Chat als Ranking-Signal nutzen“ an ist): anonym und nur lesend über Twitch-IRC
// (wss://irc-ws.chat.twitch.tv, Nutzername „justinfan…“, ohne Anmeldung). Es werden nur Zeit und Text im Arbeitsspeicher gehalten.
import type { ChatMsg } from './chat'

interface Stored { wall: number; text: string }

/** Nachricht aus einer IRC-Zeile (PRIVMSG) lesen; alles andere → null. */
export function parsePrivmsg(line: string): string | null {
  const m = line.match(/^(?:@\S+ )?:[^ ]+ PRIVMSG #\S+ :(.*)$/)
  return m ? m[1] : null
}

export class ChatRecorder {
  private ws: WebSocket | null = null
  private msgs: Stored[] = []
  private stopped = false
  private retry: NodeJS.Timeout | null = null

  constructor(private channel: string, private keepSec: number) {}

  start(): void {
    this.stopped = false
    this.connect()
  }

  private connect(): void {
    if (this.stopped) return
    try {
      const ws = new WebSocket('wss://irc-ws.chat.twitch.tv:443')
      this.ws = ws
      ws.onopen = () => {
        ws.send(`NICK justinfan${Math.floor(10000 + Math.random() * 80000)}`)
        ws.send(`JOIN #${this.channel}`)
      }
      ws.onmessage = (ev) => {
        for (const line of String(ev.data).split('\r\n')) {
          if (line.startsWith('PING')) { ws.send(line.replace('PING', 'PONG')); continue }
          const text = parsePrivmsg(line)
          if (text !== null) this.add(text)
        }
      }
      ws.onclose = () => { if (!this.stopped) this.retry = setTimeout(() => this.connect(), 4000) }
      ws.onerror = () => undefined
    } catch { this.retry = setTimeout(() => this.connect(), 8000) }
  }

  private add(text: string): void {
    const now = Date.now()
    this.msgs.push({ wall: now, text })
    const cut = now - this.keepSec * 1000
    if (this.msgs.length > 2000 && this.msgs[0].wall < cut) this.msgs = this.msgs.filter((m) => m.wall >= cut)
  }

  /** Nachrichten ab einem Zeitpunkt (Wanduhr, ms), als Sekunden relativ dazu. */
  messagesSince(startWall: number): ChatMsg[] {
    return this.msgs.filter((m) => m.wall >= startWall).map((m) => ({ t: (m.wall - startWall) / 1000, text: m.text }))
  }

  stop(): void {
    this.stopped = true
    if (this.retry) clearTimeout(this.retry)
    try { this.ws?.close() } catch { /* schon zu */ }
    this.ws = null
    this.msgs = []
  }
}
