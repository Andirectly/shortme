# V4 – praktische Modellwahl, Hardware und Entscheidungsvorrang

## Feste Architektur, flexible Implementierungsdetails

**Pflichtfähigkeiten und explizit verpflichtende Checkpoints auseinanderhalten:**

`V4-014` schreibt Qwen3-VL-Embedding-2B als Pflichtpfad vor. Ein Ersatz allein erfüllt diese ID **nicht**. Ein abweichender Checkpoint erfordert ausdrückliche Freigabe des Auftraggebers und eine versionierte Anforderungsänderung, andernfalls bleibt das technische Gate rot. Andere Rollen lassen echte lokale Alternativen gemäß Vergleichstest zu.

| Rolle | Bevorzugter realer Adapter | Gleichwertiger lokaler Ersatz / Muss-Beleg |
|---|---|---|
| Video semantic retrieval | Qwen3-VL-Embedding-2B | nur nach ausdrücklich freigegebener, versionierter Vertragsänderung; nicht als unbemerkter Default |
| Sprache | bestehende beste lokale ASR, gegen Qwen3-ASR 0.6B/1.7B messen | DE/EN mit echten Wortzeiten und bekannten Fehlern |
| VAD/silence | vorhandenes VAD oder Silero VAD | echter Audio-Signal-Output, keine Transkript-Surrogat-Scores |
| Shot/action | bestehende Szenenerkennung oder PySceneDetect | real gemessene Frame-/Shot-/Action-Edges |
| Context/Vision Judge | existierender lokaler VL-Adapter | Frames aus Source und echten Output-Probes, Belege |
| synchronized AV Judge | MiniCPM-o 4.5 wenn lokal real tragbar | Kombination aus lokalem realem Audio-Modell + lokalem echtem Video-Modell und synchronisiertem Evidenzabgleich, ausdrücklich `dual-modality-verification` statt gemeinsamer AV-Inferenz |
| Cut decision | lokaler strukturierter Judge (bestehendes Offline-LLM/VLM) | Edge-IDs, kein Cloud-Jev; Kandidatenbeurteilung mit echten Medien/Transcript |
| Ausgabe/Editor | vorhandener FFmpeg-/Editorpfad | Ausgabe durch ffprobe und echte Playback-Durchläufe bestätigt |

Bei geringer Hardware die Videoindex-/Judge-Modelle sequentiell laden. Fast verkleinert Sampling/Investigation **transparent**, aber keine Lane vollständig schweigend unterdrücken. Profile `fast`, `balanced`, `deep` mit wirklichen Budgetgrenzen und Qualitätsdifferenzen. Läuft ein Pflichtmodell nicht, offen melden und tatsächlichen gleichwertigen Ersatz ausprobieren. Niemals einen schweren 9B AV-Judge auf 12GB als garantiert funktionsfähig bezeichnen.

## Für Desktop-App / Windows

- Python 3.11/3.12 Worker über Projekt-eigene venv/uv, pinned Wheels; nicht global pip voraussetzen. Windows CUDA und CPU-Compatibility. Electron Main owns job orchestration.
- Real-GPU Smoke auf verfügbarer RTX 5090 (32GB), 5070 Ti (16GB) und 12GB wenn verfügbar, sonst `NOT_MEASURED` statt behauptete erfolgreiche Tests. Kein vererbter GPU-Prozess nach Cancel.
- Nur explizite Modellinstallation verbindet sich vorab zum Download; Analyse-Lauf vollständig offline. Prüfe Offline durch blockierte Internetverbindung mit lokal installierten Gewichten.
- Für Video-/Audio-Beobachtung immer `source_sha`, `frame_pts`, `audio_sample_range`, `model_rev`; hohe VRAM-Auslastung -> sequenzielle Schedulerstrategie.

## Auswahlentscheidung

Wenn „komplette Implementierung“ mit 50 ungetesteten Integrationen konkurriert, entscheide für wenige **wirklich getestete Kernmodelle plus alle Pflichtfähigkeiten**. Research-only Adapter zu integrieren, die zu Hardware-/Lizenz-/Qualitätsproblemen führen, widerspricht dem Ziel. Es gibt keinen erlaubten Plan, bei dem essentielle V4-Suche, AV-Verifikation, echtes Rendern, Reparatur oder 4-Engine-Vergleich nur 'optional' sind.
