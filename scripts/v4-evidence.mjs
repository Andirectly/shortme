// Engine 4 – Nachweise eintragen: führt die Testbefehle der Zuordnung (docs/v4-evidence-map.json) WIRKLICH aus, legt das Log unter docs/v4-logs/ ab,
// berechnet dessen SHA-256 und schreibt Code-/Testpfade, Befehl, Exitcode und Log in docs/ENGINE_V4_EVIDENCE.json.
// Status: „passed“ nur bei Exit 0, vorhandenen Dateien und – für IDs mit real_media – einer Lauf-ID, die mit docs/ENGINE_V4_RUN_PROOF.json übereinstimmt.
// Sonst höchstens der in der Zuordnung genannte Höchststatus (z. B. in_progress/blocked). Die Anforderungsliste wird nie verändert.
//   node scripts/v4-evidence.mjs [ID …]
import { createHash } from 'node:crypto'
import { execSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs'

const MAP = 'docs/v4-evidence-map.json', EV = 'docs/ENGINE_V4_EVIDENCE.json', PROOF = 'docs/ENGINE_V4_RUN_PROOF.json'
const REQ = JSON.parse(readFileSync('docs/implementation/shortme-engine-v4/requirements/v4_requirements.json', 'utf8')).requirements
const map = JSON.parse(readFileSync(MAP, 'utf8'))
const ev = JSON.parse(readFileSync(EV, 'utf8'))
const proof = existsSync(PROOF) ? JSON.parse(readFileSync(PROOF, 'utf8')) : null
const only = process.argv.slice(2)
mkdirSync('docs/v4-logs', { recursive: true })
const ran = new Map()

for (const r of REQ) {
  const id = r.id
  if (only.length && !only.includes(id)) continue
  const m = map[id]
  if (!m) continue
  const item = ev.requirements[id]
  const files = [...(m.implementationFiles ?? []), ...(m.testFiles ?? [])]
  const missingFile = files.find((f) => !existsSync(f) || statSync(f).size === 0)
  let exit = null, log = '', sha = ''
  if (m.testCommand && !missingFile) {
    const key = m.testCommand
    if (!ran.has(key)) {
      const logPath = `docs/v4-logs/${key.replace(/[^a-z0-9]+/gi, '_').slice(0, 80)}.log`
      let out = '', code = 0
      try { out = execSync(m.testCommand, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024, timeout: 1_800_000 }) } catch (e) { out = `${e.stdout ?? ''}${e.stderr ?? ''}`; code = typeof e.status === 'number' ? e.status : 1 }
      const text = `$ ${m.testCommand}\n# exit ${code} · ${new Date().toISOString()}\n${out}`
      writeFileSync(logPath, text, 'utf8')
      ran.set(key, { code, logPath, sha: createHash('sha256').update(readFileSync(logPath)).digest('hex') })
    }
    ;({ code: exit, logPath: log, sha } = ran.get(key))
  }
  const needsMedia = (r.required_proof ?? []).includes('real_media')
  const mediaOk = !needsMedia || (m.realMediaRunId && proof?.runId === m.realMediaRunId)
  let status = m.maxStatus ?? 'passed'
  if (missingFile) status = 'pending'
  else if (exit !== 0) status = exit === null ? (status === 'blocked' ? 'blocked' : 'in_progress') : 'failed'
  else if (!mediaOk && status === 'passed') status = 'in_progress'
  Object.assign(item, { status, implementationFiles: m.implementationFiles ?? [], testFiles: m.testFiles ?? [], testCommand: m.testCommand ?? '', testExitCode: exit, testLog: log, testLogSha256: sha, realMediaRunId: m.realMediaRunId ?? null, notes: [m.notes, missingFile ? `Datei fehlt/leer: ${missingFile}` : '', !mediaOk ? 'realer Medienlauf/Proof fehlt oder passt nicht' : ''].filter(Boolean).join(' | ') })
  console.log(`${id} ${status}${exit !== null ? ` (exit ${exit})` : ''}`)
}
writeFileSync(EV, JSON.stringify(ev, null, 2) + '\n', 'utf8')
