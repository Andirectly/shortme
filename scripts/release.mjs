// Baut den Windows-Installer und lädt ihn als GitHub-Release hoch (Quelle der In-App-Updates).
// Aufruf: npm run release   (Version aus package.json, Notizen aus CHANGELOG.md)
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
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
// `gh release create` liefert hier 404 (ID-Route), die Repo-Route der API geht: Entwurf anlegen, Dateien hochladen, veröffentlichen.
// Der Stand muss vorher auf origin/main gepusht sein (Release zeigt auf main).
const repo = 'Andirectly/shortme'
const id = execFileSync('gh', ['api', '-X', 'POST', `repos/${repo}/releases`, '-f', `tag_name=${tag}`, '-f', `name=${tag}`, '-F', 'draft=true', '--jq', '.id'], { encoding: 'utf8' }).trim()
for (const f of files) sh('gh', ['api', '-X', 'POST', `https://uploads.github.com/repos/${repo}/releases/${id}/assets?name=${basename(f)}`, '-H', 'Content-Type: application/octet-stream', '--input', f, '--silent'])
sh('gh', ['api', '-X', 'PATCH', `repos/${repo}/releases/${id}`, '-F', 'draft=false', '-f', 'make_latest=true', '-f', 'target_commitish=main', '-F', `body=@${notesFile}`, '--silent'])
console.log(`Veröffentlicht: ${tag}`)
