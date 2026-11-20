# 04 – Progressive Ergebnisse, Status und ETA

## Warum kein Fake-Fortschritt
Die heutige Beispielpipeline benötigt ca. 1min ASR + 4,5min Analyse + 25–30min Clips finden. Bei der langen dritten Phase ist ein Prozentwert ohne bekannte Anzahl Prüfaufgaben nicht zuverlässig. Zeitspannen müssen aus echten Historien und beobachteten Arbeitsmengen kommen.

## Zustandsmodell

### Jobphasen
`queued` -> `transcribing` -> `analyzing` -> `discovering` -> `finalizing` -> `completed`
plus `pausing` / `paused` / `resuming`, `stopping` / `partial_complete`, `canceled`, `failed`.

### Clip-Lifecycle
`candidate` -> `preview_ready` -> `quality_checked` -> `render_ready`.
Nicht jede Engine kann alle Zwischenzustände früh liefern. `render_ready` erst bei erfüllten Daten-/Medienvoraussetzungen. `quality_checked` kann Warnungen/Fehler enthalten.

### Review vs. Qualität
`review.status`: offen/freigegeben/zur_pruefung/verworfen.
`quality.status`: nicht_durchgefuehrt/ausstehend/bestanden/bitte_pruefen/fehlgeschlagen.
`learning.rating`: stark/mittel/schlecht/unbewertet – unabhängig.

## Event-Vertrag (Beispiel, an Repo-IPC anpassen)

```ts
interface JobEventBase {
  jobId: string; runId: string; eventId: string; sequence: number;
  occurredAt: string; // ISO-UTC, nur diagnostisch; Sequenz entscheidet
}

type JobEvent =
  | (JobEventBase & { type: 'phase.changed'; phase: string })
  | (JobEventBase & { type: 'progress.measured'; phase: string; completed: number; total: number })
  | (JobEventBase & { type: 'candidate.discovered'; clipId: string; sourceInMs: number; sourceOutMs: number })
  | (JobEventBase & { type: 'preview.ready'; clipId: string; revision: string; previewRef: string })
  | (JobEventBase & { type: 'quality.updated'; clipId: string; revision: string; status: string; findings: unknown[] })
  | (JobEventBase & { type: 'job.partial_complete'; clipIds: string[] })
  | (JobEventBase & { type: 'job.completed' | 'job.failed' | 'job.canceled' });
```

### Sicherheitsmerkmale
- Sende keine OS-Dateipfade unkontrolliert ins Renderer-Fenster; sichere Electron-IPC-Bridge/URLs verwenden.
- `eventId` + `sequence` für Duplikate/out-of-order; Rehydration aus persistenter Job-/Clipdatenbank, kein Renderer-only Zustand.
- Alte Events dürfen keinen neueren Prüfstatus oder eine neue Render-Revision überschreiben.
- Clip-ID nicht nur aus sortiertem Listenindex ableiten. Quellintervall, Run-ID, Cut-Revision und eventuell Kandidat-Fingerprint verwenden.
- Änderungen an einem bereits freigegebenen Clip -> `freigegeben` erhalten **mit** Kennzeichnung `Seit Freigabe verändert`, oder nach klarer Produktentscheidung neue Freigabe anfordern; niemals stillschweigend als technisch validiert darstellen.
- Bei `Stoppen & behalten` alle verwertbaren persistierten Kandidaten sichtbar und explizit `unvollständig` markieren.

## ETA-Algorithmus – Empfehlung
1. Erste Schätzung aus lokaler Historie (Videodauer, Engine/Modellversion, Hardwareklasse, Inhaltstyp, angeforderte Clipanzahl), nur wenn genügend Daten. Sonst `Noch keine verlässliche Schätzung`.
2. Nach Phasenabschluss tatsächliche Dauer speichern (nur lokal). Aus jüngsten ähnlichen Jobs robuste Quantile oder Median + Streubereich nutzen.
3. Während einer messbaren Phase (n von N) `completed/total` nutzen. Für unbekannten Gesamtumfang nur Schrittstatus + verstrichene Zeit.
4. ETA **Spanne** mit z. B. P25–P75 der ähnlichen Laufhistorie; wenn Streuung groß/unbekannt, weniger präzise kommunizieren.
5. ETA darf sich ändern. Verbesserung entsteht durch Transparenz und Zwischenresultate, nicht durch künstliches Herunterzählen.
6. Kein Timer, der automatisch Kandidaten erzeugt oder Markierungen als „fertig“ setzt.

## Ressourcensteuerung M1 Pro 16 GB
- Parakeet/LLMs/Video-Analyse müssen vorhandenen Ressourcen-Manager respektieren. Keine parallelen schweren Inferenzjobs nur wegen eines neuen Review-Fensters.
- Frühe Vorschau aus dem Quellvideo als leichtgewichtige Proxy/Range-Playback. Optional Vorschaurender im Low-Priority-Worker, max. ein oder wenige aktive Jobs.
- UI darf keine 10 Videoelemente gleichzeitig dekodieren.

## Erster realer Zwischenschritt, falls Engine nicht streamfähig
Zeige nach abgeschlossener Transkription das **wirklich vorhandene** Transkript an und ermögliche Markieren/Suchen. Danach mit jeder schon vorhandenen Candidate-Callback-Stelle wachsen. Erst echte Kandidaten präsentieren, wenn Clipdaten und Playback funktionieren.

## Testfälle
- Events doppelt, verspätet, nach Reload, nach Abbruch, während Review-Edit.
- Keine in 1. Engine-Lauf erzeugten Kandidaten in 2. Lauf verstecken, ohne Run-Zuordnung.
- Resume nach Crash, Stop/Keep, Stop/Discard, Failed, Model missing.
- Quelle 6h und 10 Kandidaten: Listen müssen virtualisiert/ressourcenschonend sein.
