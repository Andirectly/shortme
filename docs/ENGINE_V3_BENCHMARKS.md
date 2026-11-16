# Engine 3 – Messungen

Alle Zahlen: ein Rechner (RTX 5090 32 GB, Windows 11), ein Video (293-s-Twitch-Stream „rotpilz“, 1080p60, Profil „Ausgewogen“, 5 Clips gewünscht). **Eine** Messung je Zeile, keine Streuung, kein Test auf 1–3 h langen Videos. Die App war für die Läufe geschlossen (sonst belegt ihr `llama-server` 10 GB VRAM).

## Gesamtlauf
| Lauf | Engine | Dauer | Clips | Ereignisse (roh → gebündelt) | Bild+Ton geprüft von |
|---|---|---|---|---|---|
| v3-mwhz7gmc | Engine 3, nur Embedding-Suche + Engine-2-Prüfer | 367 s | 4 | 11 → 8 | Qwen3-VL-4B + Voxtral |
| v3-mwii7265 | Engine 3 mit Lighthouse + MiniCPM-o | 324 s | 4 | 18 → 5 | MiniCPM-o (5/5) |
| v2-… (4 Läufe) | Engine 2 | nicht neu gemessen | 4–5 | 11 | Qwen3-VL-4B + Voxtral |

## Stufen des Laufs v3-mwii7265 (Sekunden)
Keyframes 2,7 · Textsuche 14,5 · Embedding-Suche 32,6 (Index 13,2 + Modell laden) · zeitliche Verortung 16,4 · **Bild+Ton-Prüfung 73,2** (davon Modell laden ca. 25–30, Prüfung 45,8) · Bewerten/Planen 29,9 · Nahtprüfung 6,8 · Prüfen/Vergleichen 52,4.

## Modelle einzeln
| Modell | Laden | VRAM geladen | VRAM-Spitze | Arbeit |
|---|---|---|---|---|
| Qwen3-VL-Embedding-2B | 2,3 s | 4,26 GB | 4,49 GB | 10 Fenster × 4 Bilder in 0,95 s |
| Lighthouse CG-DETR (CLIP) | 4,3–4,8 s | 0,77 GB | 0,91 GB | 60-s-Video kodieren 4,1 s; 3 Fenster à 120 s samt Anfragen 16–21 s |
| MiniCPM-o 4.5 bf16 | 13–27 s | 18,1 GB | 22,0 GB | 30-s-Ausschnitt (Bild+Ton) 6,8–14 s, 10-s-Ausschnitt 9,5 s (erste Anfrage mit Aufwärmen) |

## Vergleich Engine 2 ↔ Engine 3 (gleiches Video, neuester Lauf je Engine)
3 gemeinsame Ereignisse, 1 nur Engine 3 (bei 74 s), 1 nur Engine 2 (bei 125 s) – bezogen auf das Endergebnis, nicht auf den Rohpool. Das ist **kein** Qualitätsnachweis: es gab kein blindes Urteil.

## Nicht gemessen
Lauf auf 1–3 h, 5070 Ti / 12 GB, Profil „Schnell“/„Gründlich“, Cache-Treffer-Zeiten, Gesamt-VRAM-Spitze über den ganzen Lauf in der installierten App.
