# 06 – Geprüfte GitHub-Referenzen und Lizenznotizen

**Recherche-/Prüfdatum 20.11.2026.** Dies sind **Links**, kein importierter Fremdcode. Vor Copy/Paste Quell-Lizenz und exakten Commit prüfen; Abhängigkeiten nicht ungeprüft einbauen.

| Repository | Rolle für Shortme | Lizenz-/Risikohinweis |
|---|---|---|
| https://github.com/cgallic/video-review-os | **Review-Konzept:** human approval, Reparatur-Operationen, Review-Gates und manuelle Post-Queue | MIT laut Repo, klein/jung; Python-Pipeline, kein Drop-in-React-Modul |
| https://github.com/godzilla74/ViralClips | **Clipping-Workflow:** Kandidaten-Scores, Titel, Grund, abspielbare Vorschau + Trimmen | MIT laut Repo; OpenAI optional -> bei Shortme nicht integrieren; kleine Projektbasis |
| https://github.com/openvideodev/react-video-editor | **Visuelle Editor-/Timeline-Inspiration:** großer Player, mehrspurige Timeline | Dual License mit Größen-/Unternehmensbeschränkungen; Cloud-Abhängigkeiten; **nicht kopieren ohne Berechtigung** |
| https://github.com/xzdarcy/react-timeline-editor | **React-Timeline-Komponente:** Draggable Actions, Zeitspuren | MIT; erst prüfen, ob vorhandene Shortme-Timeline genügt |
| https://github.com/katspaugh/wavesurfer.js | **Wellenformen & Regions:** präzises Trimming | BSD-3-Clause; saubere Integration mit existierendem Player nötig |
| https://github.com/wassgha/rescript | **Transcript-based Edit als UX-Inspiration** | Aktuell PolyForm Noncommercial 1.0.0; frühere MIT-Versionen ≠ aktuelle Codefreigabe; nicht ungeprüft kopieren |
| https://github.com/sindresorhus/p-queue | **Begrenzte asynchrone UI-/Preview-Jobs**, nicht Engine-Streaming-Ersatz | MIT; Queue und Abort sauber verbinden |
| https://github.com/shadcn-ui/ui | **Accessible UI-Komponenten / Designsystem-Ideen** | Lizenz pro konkreter Komponente/Commit prüfen; keine komplette Migration erzwingen |
| https://github.com/magicuidesign/magicui | **Dezente Mikroanimationen/Status-Karten** | MIT laut Repo, Performance prüfen |
| https://github.com/DavidHDev/react-bits | **Animations-Inspiration** | Lizenz/Komponentenversion verifizieren; nicht zahlreiche Daueranimationen einbauen |
| https://github.com/motiondivision/motion | **React-Übergänge** | MIT; Reduced Motion beachten |

## Klare Einsatzempfehlung
1. **Video Review OS** zuerst konzeptionell lesen, um Review-Gates und Qualitätsgründe zu verstehen; das Python-System nicht in Electron einbetten.
2. **ViralClips** als UX-Referenz für Ranking und Preview/Trim; nicht als Ersatzengine.
3. **Bestehende Shortme-Timeline** weiterverwenden. `react-timeline-editor` und `wavesurfer.js` nur nach konkretem Funktionsvergleich integrieren.
4. **OpenVideo** und **Rescript** streng auf Konzept-/UI-Inspiration beschränken, falls Lizenzlage nicht separat geklärt ist.
5. **shadcn/Magic UI/React Bits/Motion** nur bei wirklichem Nutzen. Ein kohärentes Designsystem ist wichtiger als viele Libraries.

## Externe Produktreferenzen
- https://cliprai.app/ – Suche nach Stream-Momenten, modern reduziertes Clipping-Onboarding
- https://www.opus.pro/ – Clip-Ranking, Review-Flow, Shorts-Workflow
- https://vizard.ai/ – Textschnitt und Short-Clip-Verwaltung
- https://www.klap.app/ – kurze automatische Verarbeitungsschritte
- https://www.submagic.co/ – Review, Subtitle-Vorlagen
- https://www.capcut.com/ – Schnittvorschau und Exportintegration
- https://www.descript.com/ – transcript-first video editing

**Wichtig:** Produktseiten ändern sich. Kein implizites Versprechen über bestimmte aktuelle Screens oder Features; vor gezielter Kopie aktuelle UI erneut prüfen.
