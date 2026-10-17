// Ausschnitt-Geometrie für Export (FFmpeg) UND Editor-Vorschau (Canvas): eine Quelle der Wahrheit.

export const OUT_W = 1080
export const OUT_H = 1920

export const even = (n: number): number => Math.max(2, Math.round(n / 2) * 2)

export interface SourceDims { width: number; height: number }

/** Zuschnitt eines festen Ausschnitts (Breite/Höhe/x/y in Quellpixeln) für ein Seitenverhältnis `aspect` (= Breite/Höhe des Ausschnitts). */
export function cropBox(src: SourceDims, cx: number, aspect: number, zoom: number): { w: number; h: number; x: number; y: number } {
  let h = src.height / zoom
  let w = h * aspect
  if (w > src.width) { w = src.width / zoom; h = w / aspect } // Quelle schmaler als Ziel: Breite begrenzt
  w = even(w); h = even(h)
  const x = Math.round(Math.min(src.width - w, Math.max(0, cx * src.width - w / 2)) / 2) * 2
  const y = Math.round(((src.height - h) / 2) / 2) * 2
  return { w, h, x, y }
}
