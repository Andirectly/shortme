# Engine 4 – Modellrollen (nur tatsächlich genutzte)

| Rolle | Modell / Revision | Eingaben | Lizenz Code / Gewichte | Windows/GPU-Lauf | Ersatz |
|---|---|---|---|---|---|
| ASR | Parakeet TDT 0.6B v3 int8 (sherpa-onnx), vorhandenes Shortme-Transkript | Ton | Apache-2.0 / CC-BY-4.0 (NVIDIA) | ja (CPU, seit M2) | Qwen3-ASR nicht integriert (nicht gemessen) |
| Ton-Ereignisse | YAMNet (ONNX, `yamnet-groups-1`) | Ton | Apache-2.0 | ja (CPU) | Pegel-/Stille-Signale (immer aktiv) |
| Sprach-Lane | Qwen3-14B Q4_K_M (llama-server) | Transkript | Apache-2.0 | ja, 13,6 GB | – |
| Video-Retrieval (V4-014) | **Qwen3-VL-Embedding-2B** @ `9f2f7e71…` | Bilder aus der Quelle | Apache-2.0 / Apache-2.0 | ja, 4,26 GB, Spitze 4,49 GB | keiner (Pflichtmodell) |
| AV-Prüfung, Investigator, Cut-Judge, Endprüfung | **MiniCPM-o 4.5** @ `fb09628e…`, bf16, transformers 4.51.0, `trust_remote_code` (fester Snapshot) | Bild + Ton desselben Ausschnitts / der Ausgabedatei | Apache-2.0 / Apache-2.0 (Modellkarte) | ja, 18,1 GB geladen, Spitzen 22–29 GB je nach Länge | bei Lade-/Speicherfehler: Lauf bricht mit klarer Meldung ab (kein stiller Ersatz); 16/12 GB nicht gemessen |
| Layout (Ausschnitt) | vorhandene Shortme-Layoutanalyse (SCRFD/ASD, ONNX) | Bild | MIT/Apache (Bestand) | ja | – |

Download nur über den Modell-Manager (Katalog mit fester Revision + SHA-256); der Analyse-Lauf lädt nichts (`HF_HUB_OFFLINE=1`, Worker ohne Netz).
Nicht genutzt: VideoITG (nichtkommerzielle Gewichte), LongVideoAgent-Code (keine Lizenz – nur Designidee), jevcut-Dienst (nur Algorithmusidee), VideoHighlighter (AGPL), Lighthouse (in Engine 3, nicht in Engine 4).
