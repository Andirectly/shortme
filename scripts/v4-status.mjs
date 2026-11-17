// Engine 4 – STATUS und TRACEABILITY aus den Quellen der Wahrheit erzeugen (Anforderungen, ENGINE_V4_EVIDENCE.json, v4_gate.py --json). Keine Zahl von Hand.
//   node scripts/v4-status.mjs <python-exe>
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'

const py = process.argv[2] ?? 'python'
const REQ = JSON.parse(readFileSync('docs/implementation/shortme-engine-v4/requirements/v4_requirements.json', 'utf8')).requirements
const ev = JSON.parse(readFileSync('docs/ENGINE_V4_EVIDENCE.json', 'utf8')).requirements
const gate = (level) => { try { return JSON.parse(execFileSync(py, ['-I', 'docs/implementation/shortme-engine-v4/tools/v4_gate.py', '--repo', '.', '--level', level, '--json'], { encoding: 'utf8' })) } catch (e) { return JSON.parse(e.stdout) } }
const core = gate('core'), all = gate('all')
const sha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const count = (s) => REQ.filter((r) => (ev[r.id]?.status ?? 'pending') === s).length
const proof = existsSync('docs/ENGINE_V4_RUN_PROOF.json') ? JSON.parse(readFileSync('docs/ENGINE_V4_RUN_PROOF.json', 'utf8')) : null

const rows = REQ.map((r) => { const e = ev[r.id] ?? {}; const f = core.failedRequirements?.[r.id] ?? all.failedRequirements?.[r.id]; return `| ${r.id} | ${r.stage} | ${r.level} | ${r.title} | ${e.status ?? 'pending'} | ${(e.implementationFiles ?? []).join('<br>')} | ${(e.testFiles ?? []).join('<br>')} | ${e.realMediaRunId ?? '–'} | ${(e.notes ?? '').replace(/\|/g, '/')}${f && e.status === 'passed' ? ` · Gate: ${f.join('; ').replace(/\|/g, '/').slice(0, 160)}` : ''} |` })
writeFileSync('docs/ENGINE_V4_TRACEABILITY.md', `# Engine 4 – Traceability (${REQ.length} IDs)\n\nErzeugt von \`scripts/v4-status.mjs\` aus \`requirements/v4_requirements.json\` + \`docs/ENGINE_V4_EVIDENCE.json\` (Git ${sha.slice(0, 10)}).\n\n| ID | Stage | Level | Titel | Status | Implementierung | Tests | Real-Run | Hinweis |\n|---|---|---|---|---|---|---|---|---|\n${rows.join('\n')}\n`, 'utf8')

const ids = (s) => REQ.filter((r) => (ev[r.id]?.status ?? 'pending') === s).map((r) => r.id).join(', ') || '–'
writeFileSync('docs/ENGINE_V4_STATUS.md', `# Engine 4 – Status\n\nGit ${sha} · erzeugt ${new Date().toISOString()} von \`scripts/v4-status.mjs\`.\n\n` +
`- Anforderungen: ${REQ.length} (core ${REQ.filter((r) => r.level === 'core').length}, quality ${REQ.filter((r) => r.level === 'quality').length})\n` +
`- passed ${count('passed')} · in_progress ${count('in_progress')} · blocked ${count('blocked')} · failed ${count('failed')} · pending ${count('pending')}\n` +
`- **Core-Gate: ${core.gate}** (${core.passed}/${core.total} bestanden) · **Quality-Gate: ${all.gate}** (${all.passed}/${all.total})\n` +
`- Run-Proof: ${proof ? `${proof.runId} · Quelle ${proof.sourceProbe?.streams?.join('+')} ${proof.sourceProbe?.durationSeconds?.toFixed?.(1)} s · Ausgabe ${proof.outputProbe?.streams?.join('+')} ${proof.outputProbe?.durationSeconds?.toFixed?.(1)} s` : 'fehlt'}${core.runProofErrors?.length ? ` · Proof-Fehler: ${core.runProofErrors.join('; ')}` : ''}\n\n` +
`## Nach Zustand\n- passed: ${ids('passed')}\n- in_progress: ${ids('in_progress')}\n- blocked: ${ids('blocked')}\n- failed: ${ids('failed')}\n- pending: ${ids('pending')}\n\n` +
`## Engineering complete?\n${core.gate === 'PASS' ? 'Core-Gate grün – zusätzlich nötig: menschlich geprüfter realer E2E-Lauf in der App.' : 'NEIN. Core-Gate rot; offene IDs siehe oben und docs/ENGINE_V4_NEXT_SESSION.md.'}\n\n## Quality validated?\nNEIN – ${all.gate === 'PASS' ? '' : 'Quality-Gate rot: '}keine 20 gelabelten Quellen, keine 2 Blind-Reviewer, keine Ablation (externe Eingaben).\n`, 'utf8')
console.log(`core ${core.gate} ${core.passed}/${core.total} · all ${all.gate} ${all.passed}/${all.total}`)
