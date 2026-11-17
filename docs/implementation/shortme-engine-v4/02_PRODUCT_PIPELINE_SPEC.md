# ENGINE V4 – neue vollständige Retrieval → Investigation → Cut → Verify Pipeline

V4 ist **keine neue Modellgewicht-Datei**. „Viertes Modell“ heißt vierter auswählbarer Analysemotor, der lokal aus mehreren Komponenten besteht. Verbessern heißt weniger fehlende Highlights, bessere eigenständig verständliche Cuts und weniger manuelle Arbeit, nicht mehr Halluzinationen.

## Stages und sichtbare Outputs

`S0 probe/config` → `S2 Cheap full-source observables` → `S3 Independent candidate lanes` → `S3 Fuse+diversify` → `S4 Bounded agent investigation` → `S4 Event graphs` → `S5 Measured cut-lattice` → `S5 Local semantic edge judge / variants` → `S6 Render` → `S6 Actual-output AV judge` → `S6 targeted repair/re-render` → `S6 select` → `S7 existing editor/export & V1–V4 compare` → `S9 holdout`.

### A. Billige vollständige Sichtung (1–6 Stunden)

- `ffprobe` liefert Streams, PTS/timebase, VFR-Flags, offsets, duration. Speicher `SourceInfo` mit SHA und Version; SourcePTS als Basis, keine Float-Drift von UI-Zeit.
- Audio billig: RMS/LUFS-ähnliche Features (klar benennen), Silero-VAD oder Bestands-VAD, Pausen, Sprachwechsel, auffällige Ausschläge, Musik/Umgebungswechsel. VAD allein darf niemals „witzig“ behaupten.
- Video billig: Shotwechsel und adaptive Frame-Sampling; gegen zu geringe Dichte prüfen, Zeitbereiche mit Cuts/Bewegung/Overlays/Gameplay separat markieren. Frame nur als Evidence, nicht unberechtigt Gesamtstory aus Einzelbildern ableiten.
- ASR lokal (bewährte Bestands-ASR oder Qwen3-ASR) mit Wort-IDs, Chunk-Offsets/Aligner, language detection, Vertrauenswerten, Sprecherturns sofern real; invalid speech => unknown.
- Visuelle semantische Videoembeddings **tatsächlich aus Frames**, Qwen3-VL-Embedding-2B, lokaler Suchindex je Source/Checkpoint/Samplingversion; Heterogeneous embeddings nie blind zusammenführen.
- Coverage buckets über **gesamte Quelle** für jede Lane: `inspected | partial | failed | skipped(reason)`. Späte Highlights dürfen keine Sampling-Abkürzung verlieren. Adaptive hohe Dichte rund um Seeds, günstige regelmäßige Proben auch im letzten 10 %.

### B. Vier unabhängige Kandidatenquellen, no-single-lane domination

1. **Speech**: überraschende Aussagen, Konflikt, Reveal, abschließbare These, Anekdote, Comedy mit überprüfbarem Referent. Nie ohne Context Verify.
2. **Audio**: Lachen, Jubel, plötzliche Reaktion, unerwartete Stille, Musik-/Beatwechsel, Mic-/Crowd-Ereignis, nicht-sprachlicher Sound. Kann Clip liefern auch bei ASR-Fehler.
3. **Visual**: Game-Win/Loss, Face-Reaction, Stunt/Fail, Objektbewegung, On-screen Action, Meme-Visuals. ASR vollständig ignorieren dürfen.
4. **Cross-modal retrieval**: positive/negative Queries auf Videoembeddings, Query-Bank ohne Pflichtkategorien; gezielte Nachsuche nach Kontext oder Folgeereignis.

Reserviere Candidate-Budgets je Lane; MMR+RRF/äquivalente Rankfusion; near-duplicates eventbasiert (Anchor/Event IDs, nicht bloß 60s Abstand). Jede Seed besitzt Evidence IDs, SourceSpan, lane/source_model. Insufficient data => `unknown`, nicht silent 0. Rankingwerte sind keine objektiven Viralitäts-Prognosen.

### C. Bounded Active Investigator (LongVideoAgent-inspiriert)

Pro Seed bis z. B. 5 echte Tool Calls (konfigurierbar) mit `inspect_before`, `inspect_after`, `inspect_video`, `inspect_audio`, `retrieve_related`, `verify_av`, `stop`. Der deterministische Scheduler erzwingt max-Window, per-Seed Tokens, Walltime und GPU-Budget. Lokales Modell darf Fragen/Queries vorschlagen, muss aber nur **validierte erlaubte Operationen** ausführen; kein Zugriff auf Shell/Dateisystem durch Prompt. Muss in Regression mindestens einen realen Zweitfenster-Kontextabruf zeigen, nicht immer nur erstes Fenster.

Jeder Output verweist auf Frame-PTS, Audio-SampleRanges, ASR-WordIDs oder reale Observables. Graphrollen `setup → trigger → action → reaction → payoff` nur wenn tatsächlich beobachtet, andernfalls `unknown`. Relation `caused` nur mit belegbarer Folge; markiere Interpretationen als `inferred`. Zusätzlich Counterexample/Contradiction-Check, um aus Kontext gerissene Aussagen zu vermeiden.

### D. Jevcut-Prinzip für wirklich gute Schnittgrenzen

1. `enumerate_edges(source)` aus Word/Sentence Ends, speech pauses (nicht blind 350ms bei Musik!), speaker changes, shots, action transitions, reaction, audio phrase, source boundary, manuelle bewiesene Edges. Edge immer `{edgeId,sourcePts,kind,evidenceIds,isMeasured}`.
2. Für Eventgraph candidate openers/enders aus kompatiblen Edges mit echter Kontextdeckung enumerieren. Nicht raten, dass 20 sec „vorher“ ausreichend sei.
3. **Lokaler** Cut-Judge sieht den *Kandidatenclip*, wählt **ID** statt freier Zeit; verifiziert Start-Verständlichkeit, Pronomen, Vollständigkeit der Aussage, Payoff, Reaktion und natürlicher Tonabschluss. Aus Jevcut nur Algorithmus; dessen gehosteter TypSafe/Jev/OpenRouter-Backend **nicht übernehmen**.
4. `variants`: Hook-first, Context-safe, Natural-payoff (wenn sinnvoll) mit 2–5 Varianten. Bei instrumentalen/rap/Gaming-Events dominieren Medienedges statt Satzzeichen.
5. Keine downstream-Funktion bekommt freie Model-Timestamps, sondern Zeit aus realen `edgeId` plus vorhandener `TimeMap`. Geschnittene mehrteilige KeepPieces dürfen nur mit belegter Kontext-/Kausalitätsintegrität kombiniert werden.

### E. Qualität **der gerenderten Datei**, nicht der Idee

- Für jeden Finalisten tatsächlichen Preview/Export **mit Ton und Bild** rendern. Mediendaten decodieren und tatsächliche Duration, Audio Stream und Frames prüfen.
- Bewertungsrubrik: `hook`, `standalone`, `payoff`, `natural-end`, `audio-seam`, `visual-seam`, `essential-event`, `caption-sync`, `crop-safety`, `dead-air`; pro Feld `pass|fail|unknown|not-applicable` (letzteres nur bei nachgewiesener Nichtanwendbarkeit) + Beleg/Reason. Kein allpass Default.
- Bei fail: minimaler geordneter Reparaturplan **1 Grund/Iteration**, z. B. opener auf vorherige gemessene Kante, Ender auf Folge-Edge, kurzen Dead-Air-Gap entfernen, neue Crop/Caption-Sync. Neu rendern, real neu prüfen. **Max 2** Repair-Runden und `needs-review` falls Unsicherheit. Jeder OutputSha muss im Judge stehen.
- Ranke nur `acceptable` und offen markierte `needs-review`, lasse reinen Mist weg. `reject` nicht exportieren außer Debug explizit.

### F. Inhaltsspezifische Checks

- Podcast: vollständiges Subjekt/Pronomen, kein verfälschender Kontext, Standalone-Erklärung.
- Twitch Just Chatting: Überraschungsaufbau und Reaktion, nicht nur Lautstärkepeak.
- Gaming: visuell bewiesene Action **und** Folge; Clip darf bei ASR=empty entstehen.
- Rap/Performance: musikalisch sinnvoller Anfang/Ende, keine Silben-/Beat-Abbrüche, Rap-Text kann ASR unsicher sein.
- Stille/Szenen: wenn nonverbal visuelles Ereignis, darf Audio-Feld `absent` sein und Judge entsprechend `not-applicable` nach echtem Probe.
- Negative Videos: Engine soll **null** Clips vorschlagen dürfen, statt Low-Quality Fake Highlights.

### G. Warum diese Reihenfolge

Full-source recall zuerst, qualitative Kontextprüfung erst nach dem billigen Seed Pool; der finale Schnitt ist eine zusätzliche Entscheidung, nicht bloß ein Crop eines Scores. Cache/Provenienz pro Stage; Scheduling auf limitierten Windows-GPUs sequentiell. Qualität in Holdout prüfen, A/B und Ablation sind Pflicht.
