# Engine 3 – Lizenzen und Gates

Stand 2026-11-15. Shortme wird nur privat genutzt (CLAUDE.md); eine kommerzielle Freigabe wurde für **nichts** hier geprüft. Quellen sind die Modellkarten/Repos zum Zeitpunkt der Integration, nicht neu rechtlich bewertet.

| Baustein | Code-Lizenz | Gewichte-Lizenz | Revision / Prüfsumme | Status |
|---|---|---|---|---|
| Qwen3-VL-Embedding-2B | Apache-2.0 (QwenLM/Qwen3-VL-Embedding, Commit `393e2978`, vendored in `resources/python/vendor`, NOTICE dort) | Apache-2.0 laut Modellkarte | HF-Revision `9f2f7e71…`, SHA-256 je Datei im Katalog | läuft |
| MiniCPM-o 4.5 | Apache-2.0 laut Modellkarte (OpenBMB) | Apache-2.0 laut Modellkarte | HF-Revision `fb09628e…`; LFS-Prüfsummen gegen die HF-API geprüft, kleine Dateien selbst berechnet | läuft |
| Lighthouse (CG-DETR) | Apache-2.0 (line/lighthouse, Commit `9b04316e`) | Checkpoint Zenodo 13960580, **CC-BY-4.0**, Autor Taichi Nishimura (LY Corporation); MD5 laut Zenodo geprüft, SHA-256 im Katalog | `clip_cg_detr_qvhighlight.ckpt` (143 416 407 Byte) | läuft |
| CLIP ViT-B/32 | MIT (openai/CLIP, Commit `d05afc43`) | MIT (OpenAI) | SHA-256 `40d36571…` (steht im offiziellen Download-Pfad, von `clip.load` geprüft) | läuft |
| uv 0.13.1 | Apache-2.0/MIT | – | SHA-256 des Release-Zips im Code | läuft |
| PyTorch 2.8.0+cu128, transformers 4.51.0 / 4.57.6 u. a. | BSD / Apache-2.0 | – | Embedding-Umgebung: Hash-Lock; AV-Umgebung: feste Versionen ohne Hashes | läuft |
| VideoITG (NVlabs) | Apache-2.0 (Code) | **nichtkommerzielle** Research-Preview | – | `license-blocked`: nicht integriert, kein Download |
| MOSS-VL, TEMPURA, TRINITY, QB-Highlights, Qwen3-VL-Reranker, Marlin, TripleSumm | nicht geprüft | nicht geprüft | – | `not-implemented` |

## Bekannte Risiken
- **Pickle:** Der Lighthouse-Checkpoint ist eine PyTorch-Pickle-Datei (Lighthouse lädt mit `weights_only=False`). Es darf nur der geprüfte Checkpoint dorthin; Quelle ist Zenodo (offizielle Veröffentlichung der Autoren), Prüfsumme fest im Katalog. Eine Signatur der Autoren gibt es nicht.
- **`trust_remote_code`:** MiniCPM-o führt Python-Code aus dem Modellordner aus. Der Ordner ist auf eine feste Revision mit Prüfsummen gebunden; Netzwerk ist im Worker ausgeschaltet (`HF_HUB_OFFLINE=1`).
- **AV-Umgebung ohne Hashes:** Lighthouse und CLIP werden als Git-Commit installiert (fest gepinnt); die Paketliste hat deshalb keine `--require-hashes`-Absicherung.
- CC-BY-4.0 verlangt Namensnennung der Lighthouse-Gewichte (hier festgehalten).
