# Review-Checkliste (menschliches Urteil)

## M0
- [ ] ASR: 50 Wörter aus `spikes/out/asr-parakeet.json` / `asr-whisper.json` gegen das Audio prüfen (z. B. 230–250 s in podcast-2p) – welches Modell macht weniger Fehler?
- [ ] Tracking: 20 Momente aus podcast-2p (`npx tsx --tsconfig tsconfig.node.json scripts/test-asd.ts test-videos/podcast-2p.mp4 200 260 --annotate .tmp/asd`) – ist die als sprechend markierte Person (grüne Box) richtig? Ziel ≥ 18/20
- [ ] LLM: `spikes/out/llm-*.json` – sind die gewählten Clips inhaltlich sinnvolle Mikro-Geschichten? Qwen3 vs. Gemma
- [ ] Untertitel: `spikes/out/subs-out.mp4` ansehen – Qualität/Sync ok?

## Vorgemerkt für fehlendes `nofaces.mp4` (M5, M3, M4)
- [ ] M3: Transkription eines Videos ohne Sprache/mit Musik: kein Halluzinieren von Text in Stille (Silero-VAD prüfen)
- [ ] M4: Clip-Auswahl funktioniert ohne Sprecher-/Gesichtssignale
- [ ] M5: nie ein leerer Ausschnitt – Fallback `fit` greift in jedem Shot ohne Gesicht
- [ ] M5: Gesichtsquote-Warnung (< 60 %) erscheint, Ranking-Abzug sichtbar
- [ ] M6: Export von `fit`-Layout (unscharfer Hintergrund) visuell prüfen
