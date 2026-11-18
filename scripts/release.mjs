// Baut das Paket für die laufende Plattform und lädt es ins GitHub-Release (Quelle der In-App-Updates).
// Aufruf: npm run release   (Version aus package.json, Notizen aus CHANGELOG.md)
// Windows → Setup-.exe + latest.yml, Mac → .dmg. Ist das Release schon da (andere Plattform zuerst gebaut),
// kommen nur die Dateien dieser Plattform dazu. Reihenfolge egal: erst Windows, dann Mac oder umgekehrt.
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { tmpdir } from 'node:os'

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const tag = `v${version}`
const mac = process.platform === 'darwin'
const repo = 'Andirectly/shortme'
const sh = (cmd, args) => {
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' && cmd === 'npm' })
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} fehlgeschlagen`)
}
const api = (args) => execFileSync('gh', ['api', ...args], { encoding: 'utf8' }).trim()

// Jede Version braucht Notizen
const notes = execFileSync('node', ['scripts/changelog-section.mjs', version, '--require'], { encoding: 'utf8' })
const existing = spawnSync('gh', ['api', `repos/${repo}/releases/tags/${tag}`, '--jq', '[.id, ([.assets[].name] | join(","))] | @tsv'], { encoding: 'utf8' })
const [releaseId, assetList] = existing.status === 0 ? existing.stdout.trim().split('\t') : [null, '']

const files = (mac
  ? [`Shortme-${version}-arm64.dmg`]
  : [`Shortme-Setup-${version}.exe`, `Shortme-Setup-${version}.exe.blockmap`, 'latest.yml']
).map((f) => join('release', f))
if (releaseId && files.some((f) => assetList.split(',').includes(basename(f)))) throw new Error(`${tag} hat die ${mac ? 'Mac' : 'Windows'}-Dateien schon. Version in package.json erhöhen.`)

sh('npm', ['run', 'package', '--', ...(mac ? ['--mac'] : []), '--publish', 'never'])
for (const f of files) if (!existsSync(f)) throw new Error(`${f} fehlt nach dem Build`)

// `gh release create` liefert hier 404 (ID-Route), die Repo-Route der API geht: Entwurf anlegen, Dateien hochladen, veröffentlichen.
// Der Stand muss vorher auf origin/main gepusht sein (Release zeigt auf main).
const id = releaseId ?? api(['-X', 'POST', `repos/${repo}/releases`, '-f', `tag_name=${tag}`, '-f', `name=${tag}`, '-F', 'draft=true', '--jq', '.id'])
for (const f of files) sh('gh', ['api', '-X', 'POST', `https://uploads.github.com/repos/${repo}/releases/${id}/assets?name=${basename(f)}`, '-H', 'Content-Type: application/octet-stream', '--input', f, '--silent'])
if (!releaseId) {
  const notesFile = join(mkdtempSync(join(tmpdir(), 'shortme-rel-')), 'notes.md')
  writeFileSync(notesFile, notes)
  sh('gh', ['api', '-X', 'PATCH', `repos/${repo}/releases/${id}`, '-F', 'draft=false', '-f', 'make_latest=true', '-f', 'target_commitish=main', '-F', `body=@${notesFile}`, '--silent'])
}
console.log(`${releaseId ? 'Ergänzt' : 'Veröffentlicht'}: ${tag} (${mac ? 'Mac' : 'Windows'})`)
