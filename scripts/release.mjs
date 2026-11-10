// Baut den Windows-Installer und lädt ihn als GitHub-Release hoch (Quelle der In-App-Updates).
// Aufruf: npm run release   (Version aus package.json, Notizen aus CHANGELOG.md)
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const tag = `v${version}`
const sh = (cmd, args) => {
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' && cmd === 'npm' })
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} fehlgeschlagen`)
}

// Jede Version braucht Notizen und darf noch nicht veröffentlicht sein
const notes = execFileSync('node', ['scripts/changelog-section.mjs', version, '--require'], { encoding: 'utf8' })
if (spawnSync('gh', ['release', 'view', tag], { stdio: 'ignore' }).status === 0) throw new Error(`${tag} ist schon veröffentlicht. Version in package.json erhöhen.`)

sh('npm', ['run', 'package', '--', '--publish', 'never'])

const files = [`Shortme-Setup-${version}.exe`, `Shortme-Setup-${version}.exe.blockmap`, 'latest.yml'].map((f) => join('release', f))
for (const f of files) if (!existsSync(f)) throw new Error(`${f} fehlt nach dem Build`)

const notesFile = join(mkdtempSync(join(tmpdir(), 'shortme-rel-')), 'notes.md')
writeFileSync(notesFile, notes)
sh('gh', ['release', 'create', tag, ...files, '--title', tag, '--notes-file', notesFile, '--latest'])
console.log(`Veröffentlicht: ${tag}`)
