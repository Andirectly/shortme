# Engine 4 – Messungen (nur Gemessenes)

Rechner: RTX 5090 32 GB, Windows 11, Node 24, Python 3.12.9. Die App war für die Läufe geschlossen (ihr `llama-server` belegt sonst 10 GB VRAM).
Eine Messung je Zeile, keine Streuung. **Keine Qualitätsaussage**: dafür fehlen Goldlabels und Blindreviews (V4-050–053, blocked).

## Läufe auf „Dinner Song“ (60 s, Bild+Ton, Gesang/Rede, Projekt f6b279f9)
| Lauf | Code-Stand | Dauer | Clips | Bemerkung |
|---|---|---|---|---|
| v4-mwjrfo9e | erste Fassung | abgebrochen | – | VRAM wuchs je MiniCPM-Aufruf bis 32 GB (kein `inference_mode`) → behoben |
| v4-mwjs8891 | + inference_mode | 702 s | 1 | 4 Renderings scheiterten (Titel mit Komma/Apostroph im Filtergraphen), 1 Endprüfung JSON abgeschnitten |
| v4-mwjsrkhi | + safeFileName | 994 s | 1 | Renderings scheiterten an Windows-Pfadlänge (Titel im Arbeitsordner) → behoben |
| v4-mwjtg728 | + neutraler Arbeitsordner, AV ≤ 40 s | 1077 s | 3 (alle `acceptable`) | 2 von 6 Endprüfungen: JSON an der Token-Grenze abgeschnitten → Belege begrenzt, Token-Grenze angehoben |

Stufen (v4-mwjtg728): Probe/YAMNet/Keyframes < 1 s (Cache), Sprach-Lane 8 s, Embedding-Lane 23 s (Index aus Cache), AV-Phase ca. 1000 s
(6 Nachuntersuchungen à 10–35 s, 6 Ereignisse × 3 Cut-Judge-Aufrufe à 15–30 s, 6 × Layout + Export + Endprüfung à ca. 60 s).

## Einzelmessungen MiniCPM-o 4.5 (bf16)
Laden 13–27 s, 18,1 GB · 10-s-Ausschnitt 9,5 s (mit Aufwärmen) · 20 s 4,7 s · 30 s 6,8–14 s · Spitze bei 30–40 s Eingabe 21–29 GB · 75 s Eingabe: über 32 GB (Auslagerung) → Eingaben auf 40 s begrenzt.

## Reparaturprobe (scripts/v4-repair-check.ts, Lauf v4-mwjtg728)
Clip absichtlich 35 % vor dem Ende abgeschnitten → Endprüfung: `payoff: fail` → Reparatur „Ende auf spätere Kante E67“ → neu gerendert (SHA fd6ad357…) → `acceptable`.

## Nicht gemessen
1–6-h-Quelle (geplant: Projekt 12b742dd, 1,8 h), Profile „Schnell“/„Gründlich“, 16-/12-GB-GPU, sauberer Windows-Erststart, Laufzeit je Stunde Material.
