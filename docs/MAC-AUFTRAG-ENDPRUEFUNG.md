# Auftrag für Claude auf dem MacBook: Endprüfung in Engine Mac verkürzen

Kann nur auf dem Mac gebaut und gemessen werden (LFM3/Qwen3.5 über mlx_vlm). Windows hat die Engine nicht.

## Befund (gemessen 0.44, 17,5-min-Vlog, 10 Wunsch-Clips, 28,5 min gesamt)
- Beobachtung Phase D (`observe`, `lfmPhase`): 408 s – LFM3 sieht die Kandidaten bereits in der Quelle.
- Endprüfung `audit-observe-*`: 472 s – LFM3 schaut **jeden gerenderten Clip komplett noch einmal an** (`packetsFor('x', span)`, `mode: 'render'`, `mac2/index.ts` ~Zeile 374–400).
- Das ist zum größten Teil doppelt: der gerenderte Clip besteht aus denselben Quellsekunden wie die schon beobachteten Pakete. Neu sind nur Anfang, Ende und Nähte (Schnitte, Cold Opener).

## Aufgabe
1. In `audit` nur noch prüfen, was der Render verändert:
   - erstes und letztes Paket des Renders (Einstieg/Ausstieg, max. je ≤ 8 s),
   - je Naht (Cold-Opener-Ende, Pausenschnitte `autoCuts`) ein kurzes Paket ±3 s.
   - Für die übrigen Abschnitte die Beobachtungen aus Phase D übernehmen (`cand.obs`, auf Render-Zeit umgerechnet: Quellzeit − Clipstart, abzüglich herausgeschnittener Bereiche).
2. `judgeRender` bekommt weiter die vollständige Beobachtungsliste (übernommen + neu), Format unverändert.
3. Sicherheitsnetz: weicht der Render von den Quell-Paketen ab (z. B. Clipgrenzen > 5 s außerhalb der beobachteten Pakete), dieses Stück neu beobachten statt übernehmen.
4. Fortschritt/Planung anpassen: `L.set('audit-packet', …)` und `L.plan(...)` mit der echten neuen Paketzahl (keine Schätzung).

## Abnahme
- Gleicher 17,5-min-Vlog, 10 Wunsch-Clips, Temperatur 0 (reproduzierbar): Endprüfungs-Beobachtung von 472 s auf ≤ 200 s, Gesamt ≤ 25 min.
- Entscheidungen (verified / needs-review) dürfen sich höchstens bei 1 von 10 Clips ändern; Unterschiede in `audits.jsonl` begründen.
- `npx vitest run` grün, `npm run typecheck` sauber.
- CLAUDE.md „Gelerntes“ um eine Zeile mit den Messwerten ergänzen, committen, `git push`.

## Seit diesem Windows-Stand neu (betrifft auch Engine Mac, bitte einmal mitprüfen)
- Chat-Spur (`chatLane`, nur wenn Twitch-Chat an ist) und gelernte Spur-Gewichte (`learnedLaneWeights`, wirken erst ab 30 Review-Entscheidungen) laufen auch in `mac2/index.ts`.
- Sprachsuche wird je Projekt zwischengespeichert (`analysis/cache/speech-<key>.json`): zweiter Lauf mit gleichem Transkript und gleicher Anfrage überspringt die Qwen-Fenster. Bitte prüfen, dass Engine Mac das sauber meldet (Fortschritt springt auf „Sprachsuche fertig“).
