// Kalter Lauf: Engine-Caches eines Projekts löschen (ASR, YAMNet, Shots bleiben – gleich für alle Engines)
const fs = require('fs'), p = require('path')
const base = p.join(process.env.SHORTME_DATA || p.join(process.env.APPDATA, 'cutawan'), 'projects', process.argv[2], 'analysis')
for (const d of ['cache', 'shared/embeddings', 'shared/embeddings-v6', 'shared/v4-checkpoints']) { fs.rmSync(p.join(base, d), { recursive: true, force: true }); console.log('gelöscht', d) }
