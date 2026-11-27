// Vorschau-Lautstärke über WebAudio: Element-Lautstärke endet bei 1 (0 dB); ein GainNode kann auch verstärken (bis +30 dB wie im Export).
// Voraussetzung: das Element lädt mit crossOrigin="anonymous" (media:// sendet CORS-Freigabe), sonst liefert WebAudio nur Stille.
let ctx: AudioContext | null = null
const nodes = new WeakMap<HTMLMediaElement, GainNode>()

/** Beim ersten Abspielen starten (Browser erlauben Ton erst nach einer Nutzergeste). */
export function startBoost(): void {
  if (!ctx) { try { ctx = new AudioContext() } catch { return } }
  if (ctx.state === 'suspended') void ctx.resume()
}

function boost(el: HTMLMediaElement): GainNode | null {
  const known = nodes.get(el)
  if (known) return known
  if (!ctx || el.crossOrigin !== 'anonymous') return null
  try {
    const g = ctx.createGain()
    ctx.createMediaElementSource(el).connect(g).connect(ctx.destination)
    nodes.set(el, g)
    return g
  } catch { return null }
}

/** Pegel als Faktor (1 = unverändert, auch > 1); ohne WebAudio auf 1 begrenzt. */
export function setLevel(el: HTMLMediaElement, gain: number): void {
  const g = boost(el)
  if (g) { if (el.volume !== 1) el.volume = 1; if (Math.abs(g.gain.value - gain) > 1e-4) g.gain.value = gain } else el.volume = Math.max(0, Math.min(1, gain))
}
