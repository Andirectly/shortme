# Verifizierte GitHub-Bausteine und tatsächliche Rolle in V4

**Recherchestand: 16. November 2026**. Lizenzen und Checkpointrechte zur konkreten Source-/Weights-Revision vor Einbau erneut bestätigen. GitHub-README ist keine Laufgarantie. Lizenz für Code ≠ Lizenz jedes Modellgewichts/Abhängigkeit.

| Repo / Quelle | V4-Verwendung | Integrationsbeschluss / Limit |
|---|---|---|
| **jevcut** https://github.com/VBS2004/jevcut | **verpflichtendes Cut-Point-Lattice und Standalone-/Payoff-Gate als eigene Implementierung** | Repo MIT; originaler `Jev`/TypeSafe/OpenRouter Pfad nutzt gehosteten Dienst. Nicht als Offline-KI verkaufen. Eigene lokale Judge-Adapterschicht. 38 annotierte Videos als Research-Methode, deren Ergebnisse nicht auf Shortme übertragen. |
| **LongVideoAgent** https://github.com/longvideoagent/LongVideoAgent | **verpflichtendes bounded investigate→ground→vision Prinzip** | QA-/RL-Forschungsrepo für Videos, keine echte Highlight-Engine; eigene deterministische Scheduler-Regeln, kein Cloud-RL-/Grok-Stack kopieren. **Keine LICENSE-Datei im Repo gefunden** (Stand Prüfung 16.11.2026): ausschließlich Architekturidee nutzen; niemals Code kopieren, bevor Rechte geklärt sind. Weights separat kontrollieren. |
| **Qwen3-VL-Embedding** https://github.com/QwenLM/Qwen3-VL-Embedding / https://huggingface.co/Qwen/Qwen3-VL-Embedding-2B | **verpflichtende reale lokale visuelle semantische Search-Lane** | Repo/2B-Modellkarte zeigen Apache-2.0; unterstützt Video. Nicht als Audio+Video oder Virality-Score ausgeben. Frame-Sampling und Indexdimension prüfen. |
| **Qwen3-ASR** https://github.com/QwenLM/Qwen3-ASR | lokale DE/EN ASR/Word timings überprüfen/ggf. ergänzen | Apache-2.0 Repo; ForcedAligner bis 5 Minuten je Segment, lange Quellen sicher chunk+offset. Bestehende lokale ASR ist zulässig, wenn **besser oder gleich**, mit realem Nachweis. |
| **MiniCPM-o 4.5** https://github.com/OpenBMB/MiniCPM-V / https://huggingface.co/openbmb/MiniCPM-o-4_5 | echte Audio-/Video-Kontextprüfung | Repo + Modellkarte Apache-2.0 (vor genutzter Revision prüfen). ~9B, Real-AV-Input; nicht jedes System kann es ausführen. Bei fehlender VRAM-/Deutschleistung lokaler echter Video+Audio-Fallback mit transparenter Kombination, *nicht* ASR-only. |
| **PySceneDetect** https://github.com/Breakthrough/PySceneDetect | gemessene Shot-/Transition-Edges | BSD-3-Clause. 0.7.3 öffentlich Nov 2026 erwähnt; Version locken und VFR prüfen. |
| **Silero VAD** https://github.com/snakers4/silero-vad | Sprachaktivität/Stille als billige Audiofeature | MIT, nicht automatisch „interessante“ Höhepunkte; vorhandenes VAD kann gleichwertig sein. |
| **auto-editor** https://github.com/WyattBlue/auto-editor | Schnitt-/Audio-Pause-/Resolve/Timeline-Exportideen | Unlicense (source); Re-Use nur wenn bestehender Editor nicht beschädigt; Binary-Lizenzen separat. |
| **WhisperX** https://github.com/m-bain/whisperX | ASR/Wort-Zeiten/Diarization-Pfad als Gegenprobe | Prüfe echte Installed Weights, FFmpeg, Python/Windows und Dependencies; kein ungemessener „70x“-Transfer auf Nutzerhardware. |
| **pyannote** https://github.com/pyannote/pyannote-audio | Speaker Turns falls gewünscht/kein gleichwertiger Bestand | Framework open source; `community-1` Modellzugang erfordert explizite HF-Bedingungen; optionaler Sprecherverbesserer, keine heimliche Zugriffsblockade für Pflichtpipeline. |
| **VideoHighlighter** https://github.com/Aseiel/VideoHighlighter | nur Ideen zu Evidence Reporting und Feedback | AGPL/non-trivial commerciale Compliance: **Code nicht übernehmen** ohne rechtliche Freigabe. |

## Wichtiges für Claude Code

- Jevcut `README`, `BENCHMARKS.md`, `RESEARCH.md`, `docs/EVAL.md`, `src/` und Unit-Tests gezielt lesen. Nicht einfach `pip install jevcut` und Cloud-Dienst voraussetzen. Vollständige lokale Portierung der **Funktionsidee**.
- LongVideoAgent README/Docs als Architektur für gezielte Zweitfensteruntersuchung; der frei vorgestellte Training-Workflow nutzt externe Dienste. Keine Abhängigkeit von deren Zugriff für Shortme.
- Alle verwendeten Modellrollen `input modalities`, `checkpoint revision`, `actual memory`, `Windows success`, `source-code license`, `weights license`, `download URL`, `trust_remote_code review`, `fallback` schriftlich festhalten. Lizenz ungeklärt => Install blockiert, ersetze funktionsgleich lokal und prüfe wiederum.
- Keine fremden großen ML-Stacks ungeprüft einbauen. Performance gewinnt durch bessere Steuerung und Kandidatenqualität, nicht durch paralleles Laden maximaler Checkpoints.

## Weitere historische Designreferenzen

V3.5 umfasst bereits Referenzalgorithmen und Forschung zu temporaler Suche/Rank-Fusion. Diese bleiben als **historical** im Paket. V4 baut den verbindlichen Funktionsumfang auf, erhält aber die eigenständige vierte Engine. Externe Github Repos nicht automatisch als kommertziell sicher ansehen.
