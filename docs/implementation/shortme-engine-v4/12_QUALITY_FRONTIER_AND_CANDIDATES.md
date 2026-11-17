# Engine V4 — Stand der Technik, Grenzen und zusätzliche Qualitätskontrollen

**Research-Update 16.11.2026.** Diese Notiz ergänzt den V4-Implementierungsvertrag; sie ersetzt **keine** der 54 Muss-IDs und ist **kein** Beweis für eine überlegene Clip-Qualität. Sie verhindert, dass einzelne Forschungsprojekte fälschlich als „bestes Modell“ oder unbedenkliche kommerzielle Abhängigkeit präsentiert werden.

## Kernentscheidung

V4 bleibt eine vierte, eigenständige **lokale** Engine: Full-source multimodal recall → investigieren → Evidenzgraph → gemessene Schnittkanten → echter Render → AV-Judge → zielgerichtete Repair-Schleife → menschlicher Blindtest. Das ist ein begründeter Engineering-Ansatz, **kein nachgewiesener State of the Art** für virale Shorts. Ein allgemeiner Video-QA-Benchmark misst nicht, ob ein Short unterhaltsam oder publizierbar ist.

## Neue aktuelle Alternativen — nur nach passendem Test und Lizenzcheck

| Projekt | Relevanz für Shortme | Begründete Entscheidung |
|---|---|---|
| **VideoITG**, https://github.com/NVlabs/VideoITG | Relevanzgesteuerte Auswahl wichtiger Videoframes für Detail-Judges, mögliche Verbesserung gegenüber Uniform-/heuristischem Sampling | Der Forschungscode ist Apache-2.0, aber die veröffentlichten **vortrainierten Modellgewichte sind laut README NVIDIA non-commercial research preview**. **Für kommerzielles Shortme NICHT diese Weights verwenden.** Architektur/Frameselektionsidee eigenständig implementieren oder kompatibles kommerziell zulässiges Verfahren auswählen. Akademische Video-QA-Steigerungen **nicht** als bessere Shorts behaupten. |
| **ClipTalk**, https://github.com/GML-MMGroup/ClipTalk | Aktive Sprechererkennung (TalkNet), speaker/face-matched editing, editierbare Timeline und Highlight Agent; besonders wertvoll für vertikale Podcast-Crops | Verfügbare Repo-Doku zeigt diese Funktionen. **Keine direkte Code- oder Weight-Übernahme ohne explizite Lizenzprüfung** einschließlich TalkNet-Dependencies und Modelle. Nutze zunächst als Feature-/Testreferenz gegen vorhandene Shortme-Crop-/Editor-Funktionalität. |
| **Kinocut**, https://github.com/KyaniteLabs/kinocut | Typisierte FFmpeg-Operationen, Video-Receipts, Render-/Loudness-/Black-Frame-Gates | Apache-2.0 laut Repo; geeignet als **Referenz** für robuste Media-Ausgabe. Nicht automatisch als weitere Runtime-Abhängigkeit einbauen, falls Shortmes bestehender FFmpeg-Wrapper die Tests bereits besteht. Separate Abhängigkeiten/Binärlizenzen prüfen. |
| **jevcut**, https://github.com/VBS2004/jevcut | Schnittpunktkandidaten aus gemessenen Kanten + lokaler semantischer Entscheider | Bleibt zentraler Teil der V4; *prinzipiell*, nicht den hosted Jev-Stack übernehmen. |
| **LongVideoAgent**, https://github.com/longvideoagent/LongVideoAgent | Aktive zeitliche Suche + zielgerichtete Nachanalyse | Bleibt Architektur-Inspiration, nicht Nachweis einer Shorts-Leaderboard-Leistung. |

## Was für wirklich hochwertige Shorts zusätzlich zwingend geprüft werden muss

Die V4-Requirements enthalten bereits `hook`, `payoff`, `standalone`, `crop-safety`, `caption-sync`, Editor-Export und Caption-Konsistenz. Claude muss im S0-Audit anhand **echter Codepfade und gerenderter Clips** prüfen, ob die vorhandene Shortme-App folgende Endnutzerfunktionen tatsächlich beherrscht; falls nicht, darf nicht „Top-Qualität Shorts komplett“ behauptet werden:

1. **Einstieg & Dramaturgie**: Früh erkennbare Relevanz, kein verlorener Kontext, tatsächliche Pointe/Emotion, keine künstliche Viralitätsprognose.
2. **Vertikale Inszenierung**: Bildausschnitt bleibt über Sprecherwechsel, Gameplay und Reaktionen auf dem relevanten Subjekt; Gesichter/UI/HUD/Untertitel bleiben sichtbar; bei zwei Personen angemessener Split/Dynamic Crop, wenn im Bestand verfügbar bzw. für das Ausgabeformat erforderlich.
3. **Untertitel & Timing**: Wortgenaue Synchronität nach Re-Edits, keine abgeschnittenen Zeilen, Text-Safe-Zone, Sprecherunterscheidung, bei Stille kein erfundener Text.
4. **Sound & Pace**: Natürliches Sprach-/Beatende, keine hart abgeschnittenen Wörter, knallenden Seam-Artefakte oder unangemessen langen Pausen; richtige Lautstärke des gerenderten Clips.
5. **Re-Editierbarkeit**: Menschliche Korrektur bleibt im Projekt erhalten; Auto-Repair darf nicht User-Edits überschreiben.

Für vorhandene Features sind **Regressionstests** Pflicht; neue Codeabhängigkeiten nur dann einsetzen, wenn ein messbarer Fehler der bestehenden Komponente besteht. Die 54 IDs werden nicht heimlich ausgeweitet oder reduziert. Die fünf Checks sind zusätzlich im S9-Review qualitativ separat zu protokollieren. Offene Produktlücken explizit im Releasebericht nennen und nicht als „vollständig automatisches professionelles Short“ präsentieren.

## Wie wir „besser“ nachweisen

- **Mindestens 20 autorisierte Quellen** mit getrennten Creator-/Session-Gruppen sowie Podcast, Twitch, Gaming, Rap, No-Speech und negativen Beispielen.
- V1–V4 je auf exakt derselben Originalquelle und gleichem Output-Budget laufen lassen.
- Zwei unabhängige, geblindete Reviewer beurteilen die **finalen gerenderten Clips**; Option „keiner ist verwendbar“.
- Hauptmetriken: publishable Top-K, Ereignis-Recall, Schnittgrenzen, Standalone/Payoff, manuelle Editminuten, Bild-Crop-/Caption-/Audiofehler, Laufzeit/VRAM. Keine fiktiven Daten.
- **Kontrollierte Ablationen**: adaptive Investigation an/aus; eventbasierter Cut-Judge an/aus; echter Final-Judge/Repair an/aus; optional Relevanzframewahl vs. vorhandenes Sampling; optional Active-Speaker-Crop vs. Bestand.
- „Beste Shortme Engine“ wird **erst nach** Blindtest/Review ausgesprochen; vorab „ambitionierter, technisch begründeter Kandidat“.

## Freigabe-Aussage

- **Für Claude-Code-Entwicklung**: Ja, nach dem S0-Repo-Audit und Lizenzprüfung, als überprüfbarer Implementierungsauftrag.
- **Als fertige lauffähige Shortme Engine**: Nein, dies ist kein Shortme-Quellcode und enthält keine realen Windows-/Medien-Abnahmeruns.
- **Als nachweislich beste Short-Qualität**: Nein, das kann nur ein echter Vorher-Nachher-Blindtest zeigen.
