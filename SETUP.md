# Einmalige Einrichtung (vor M0)

## 1. Werkzeuge
- Node.js 20+ (LTS), Git, Visual Studio Build Tools (C++ für Native-Module)
- Claude Code
- RTK (Rust Token Killer): Installation laut README von rtk-ai/rtk, dann `rtk init -g`
  und prüfen: `rtk gain` muss Spar-Statistiken zeigen (nicht das gleichnamige „Rust Type Kit“ installieren)

## 2. Projekt anlegen
```
git clone https://github.com/JeremySNR/clip-forge.git shortme
cd shortme
```
Dann den Inhalt dieses Pakets hineinkopieren (CLAUDE.md, docs/, .claude/, SETUP.md) und `.gitignore` ergänzen:
```
reference/
test-videos/
spikes/out/
models/
```

## 3. Referenz-Repos (nur lesen)
```
mkdir reference && cd reference
git clone --depth 1 https://github.com/xixihhhh/hotclip
git clone --depth 1 https://github.com/francozanardi/tscaps
git clone --depth 1 https://github.com/GrepCut/OpenClipper
git clone --depth 1 https://github.com/fralapo/clippyme
git clone --depth 1 https://github.com/mutonby/openshorts
git clone --depth 1 https://github.com/ColinGPT9/clips-studio
cd ..
```

## 4. Testvideos
In `test-videos/` ablegen (je 5–15 Minuten reichen):
- `podcast-2p.mp4` – zwei Personen im Gespräch, Deutsch
- `solo.mp4` – eine Person spricht in die Kamera
- `nofaces.mp4` – Szenen ohne Gesicht (Screencast, B-Roll, Landschaft)

## 5. Start
`claude` im Projektordner starten → Prompt „M0“ aus docs/PROMPTS.md.
