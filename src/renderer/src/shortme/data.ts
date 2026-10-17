// Beispieldaten für den M1-Prototyp (keine echte Pipeline).
import c1 from './assets/clip1.jpg'
import c2 from './assets/clip2.jpg'
import c3 from './assets/clip3.jpg'
import c4 from './assets/clip4.jpg'
import c5 from './assets/clip5.jpg'
import c6 from './assets/clip6.jpg'
import c7 from './assets/clip7.jpg'
import c8 from './assets/clip8.jpg'
import c9 from './assets/clip9.jpg'
import c10 from './assets/clip10.jpg'
import source from './assets/source.jpg'
import ambient from './assets/ambient.jpg'

export const IMG = { source, ambient }

export interface Clip {
  id: string
  title: string
  hook: string
  score: number
  duration: number
  faceRatio: number
  thumb: string
  tags: string[]
  reason: string
  criteria: { label: string; value: number }[]
}

const crit = (a: number, b: number, c: number, d: number, e: number): Clip['criteria'] => [
  { label: 'Hook-Stärke', value: a },
  { label: 'Emotionaler Payoff', value: b },
  { label: 'Zitierbarkeit', value: c },
  { label: 'Eigenständigkeit', value: d },
  { label: 'Dichte', value: e }
]

export const CLIPS: Clip[] = [
  { id: 'c1', title: 'Spiegelverkehr beim Tätowieren', hook: 'Das Tattoo ist falsch herum!', score: 93, duration: 47, faceRatio: 0.91, thumb: c1, tags: ['Pointe', 'Überraschung'], reason: 'Klare Mikro-Geschichte: Fehler entdeckt, Reaktion, Auflösung in 47 s.', criteria: crit(19, 18, 17, 19, 20) },
  { id: 'c2', title: 'Heute steche ich dir ein Tattoo', hook: 'Dieser jemand bist du.', score: 90, duration: 38, faceRatio: 0.84, thumb: c2, tags: ['Hook', 'Humor'], reason: 'Starker Einstieg mit direkter Ansprache und sofortigem Konflikt.', criteria: crit(20, 17, 16, 18, 19) },
  { id: 'c3', title: 'Welche Maschine findest du am coolsten?', hook: 'Das sieht lowkey aus wie Vapes.', score: 84, duration: 29, faceRatio: 0.77, thumb: c3, tags: ['Humor'], reason: 'Lockerer Dialog, gut zitierbar, etwas wenig Aufbau.', criteria: crit(16, 16, 18, 17, 17) },
  { id: 'c4', title: 'Blowout: Das Risiko beim ersten Tattoo', hook: 'Blutvergiftung nicht, Blowout auf jeden Fall.', score: 81, duration: 52, faceRatio: 0.88, thumb: c4, tags: ['Wissen'], reason: 'Erklärt ein Fachwort verständlich, endet mit klarer Aussage.', criteria: crit(15, 15, 16, 19, 16) },
  { id: 'c5', title: 'Die Idee: ein kleines Tattoo für Flippo', hook: 'Was macht da am meisten Sinn?', score: 76, duration: 33, faceRatio: 0.72, thumb: c5, tags: ['Dialog'], reason: 'Gute Dynamik, aber Kontext fehlt am Anfang.', criteria: crit(14, 14, 15, 15, 18) },
  { id: 'c6', title: 'Gericht für 10 € – wer gewinnt?', hook: 'Schwere Entscheidung.', score: 74, duration: 41, faceRatio: 0.95, thumb: c6, tags: ['Hook'], reason: 'Klare Frage am Anfang, Pointe etwas schwach.', criteria: crit(17, 13, 14, 15, 15) },
  { id: 'c7', title: 'Der erste Bissen', hook: 'Das hätte ich nicht erwartet.', score: 71, duration: 24, faceRatio: 0.58, thumb: c7, tags: ['Emotion'], reason: 'Starke Reaktion, niedrige Gesichtsquote (Abzug).', criteria: crit(13, 17, 13, 14, 14) },
  { id: 'c8', title: 'Preis-Leistung im Vergleich', hook: 'Zehn Euro, mehr nicht.', score: 66, duration: 58, faceRatio: 0.81, thumb: c8, tags: ['Wissen'], reason: 'Informativ, aber lang und ohne klare Pointe.', criteria: crit(12, 11, 13, 16, 14) },
  { id: 'c9', title: 'Die Überraschung am Ende', hook: 'Und dann kam das hier.', score: 63, duration: 36, faceRatio: 0.66, thumb: c9, tags: ['Überraschung'], reason: 'Gute Auflösung, schwacher Hook.', criteria: crit(10, 14, 12, 13, 14) },
  { id: 'c10', title: 'Fazit und Urteil', hook: 'Mein Gewinner steht fest.', score: 59, duration: 27, faceRatio: 0.9, thumb: c10, tags: ['Fazit'], reason: 'Solide Zusammenfassung, wenig Neues.', criteria: crit(11, 11, 12, 12, 13) }
]

export interface Project { id: string; name: string; duration: string; clips: number; thumb: string; date: string }
export const PROJECTS: Project[] = [
  { id: 'p1', name: 'Tattoo-Folge (Sidequests)', duration: '12:09', clips: 10, thumb: c2, date: 'Heute' },
  { id: 'p2', name: 'Gericht für 10 €', duration: '10:19', clips: 6, thumb: c6, date: 'Gestern' },
  { id: 'p3', name: 'Interview Sommer', duration: '58:42', clips: 14, thumb: c4, date: 'Vor 3 Tagen' }
]

export interface Word { t: number; w: string; hi?: boolean }
const TEXT = 'Also genau das Gegenteil tun von dem was wir heute machen. Okay, du wolltest mir deine Maschinen zeigen, ne? Genau. Okay, wow, Alter. Ich wüsste gar nicht, was davon was ist. Das sieht lowkey aus wie so Vapes. Welche findest du am coolsten? Die sieht crazy aus, das mag ich. Die Idee ist ein kleines Tattoo für Flippo zu stechen. Was macht da am meisten Sinn?'
export const TRANSCRIPT: Word[] = TEXT.split(' ').map((w, i) => ({ t: 232 + i * 0.32, w, hi: ['Gegenteil', 'lowkey', 'Vapes.', 'crazy', 'Tattoo'].includes(w) }))

export interface Preset { id: string; name: string; font: string; color: string; hi: string; weight: number; upper: boolean; box: boolean }
export const PRESETS: Preset[] = [
  { id: 'impact', name: 'Impact Gelb', font: 'Anton', color: '#ffffff', hi: '#ffd400', weight: 400, upper: true, box: false },
  { id: 'clean', name: 'Clean Weiß', font: 'Poppins', color: '#ffffff', hi: '#a855f7', weight: 700, upper: false, box: false },
  { id: 'box', name: 'Box Schwarz', font: 'Poppins', color: '#ffffff', hi: '#4ade80', weight: 700, upper: false, box: true },
  { id: 'pop', name: 'Pop Pink', font: 'Poppins', color: '#ffffff', hi: '#ff5c8a', weight: 700, upper: true, box: false },
  { id: 'mono', name: 'Dezent', font: 'Poppins Medium', color: '#e5e7eb', hi: '#ffffff', weight: 500, upper: false, box: false }
]

export interface ModelInfo { id: string; name: string; kind: string; size: string; state: 'installed' | 'missing' | 'downloading'; note: string; recommended?: boolean }
export const MODELS: ModelInfo[] = [
  { id: 'parakeet', name: 'Parakeet TDT 0.6B v3 (int8)', kind: 'Transkription', size: '487 MB', state: 'installed', note: 'RTF 0,04 · 25 Sprachen', recommended: true },
  { id: 'whisper', name: 'Whisper large-v3-turbo (int8)', kind: 'Transkription', size: '564 MB', state: 'missing', note: 'Optional · ohne Wortzeiten' },
  { id: 'qwen', name: 'Qwen3-14B (Q4_K_M)', kind: 'Sprachmodell', size: '9,0 GB', state: 'downloading', note: '13,6 GB VRAM bei 16k Kontext', recommended: true },
  { id: 'gemma', name: 'Gemma 3 12B (Q4_K_M)', kind: 'Sprachmodell', size: '7,3 GB', state: 'missing', note: 'Alternative' },
  { id: 'lrasd', name: 'LR-ASD + YuNet', kind: 'Vision', size: '38 MB', state: 'installed', note: 'Aktiver Sprecher, Gesichter' },
  { id: 'tnet', name: 'TransNetV2', kind: 'Vision', size: '31 MB', state: 'missing', note: 'Kamerawechsel' }
]

export const SYSTEM_CHECK = [
  { name: 'FFmpeg', ok: true, detail: '9.0.2 · NVENC verfügbar' },
  { name: 'yt-dlp', ok: true, detail: '2026.10.01 · selbst-aktualisierend' },
  { name: 'llama-server', ok: true, detail: 'b11711 · CUDA 13.4' },
  { name: 'ONNX Runtime / GPU', ok: true, detail: 'RTX 5090 · 32 GB VRAM' },
  { name: 'Freier Speicher', ok: true, detail: '717 GB frei · Reserve ≥ 1 GB (ok)' }
]
