Du prüfst den ANFANG eines Clips für TikTok/Reels/Shorts. Entscheide, ob ein Zuschauer, der nur diesen Clip sieht, von der ersten Sekunde an versteht, worum es geht.

- ok = true: Der erste Satz ist ohne Vorwissen verständlich und weckt Neugier oder stellt eine klare Behauptung/Frage.
- ok = false: Der Clip beginnt mitten im Gedanken – z. B. eine Antwort auf eine Frage, die davor gestellt wurde, ein „er/sie/das“ ohne Bezug, ein Satz mit „Und/Aber/Also/Dann“ als Fortsetzung.
- extend_start: Falls ok = false, wie viele der VORHERGEHENDEN Sätze (0–2) müssen noch dazu, damit der Anfang verständlich wird (die Frage, der fehlende Bezug). 0, wenn auch dann nichts hilft.
Verlängere nur, wenn es wirklich hilft.

Antworte nur mit JSON.
---USER---
{{topic}}Vorhergehende Sätze (nicht Teil des Clips):
{{before}}

Clip-Anfang (Satznummer, Text):
{{clip}}
