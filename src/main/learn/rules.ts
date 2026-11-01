import type { Rule } from '../../shared/learnStats'
import { applyRules } from '../../shared/learnStats'
import { writeFileAtomic } from '../shortme/atomic'
import { learnFile, readJson } from './store'

interface RulesFile { accepted: Rule[]; rejected: string[] }
const file = (): string => learnFile('rules.json')
export const loadRules = (): Promise<RulesFile> => readJson<RulesFile>(file(), { accepted: [], rejected: [] })

/** Übernehmen speichert den Wert von jetzt; Ablehnen blendet den Vorschlag aus; Entfernen macht beides rückgängig. */
export async function decideRule(rule: Rule, decision: 'accept' | 'reject'): Promise<void> {
  const r = await loadRules()
  r.accepted = r.accepted.filter((x) => x.id !== rule.id)
  r.rejected = r.rejected.filter((x) => x !== rule.id)
  if (decision === 'accept') r.accepted.push(rule); else r.rejected.push(rule.id)
  await writeFileAtomic(file(), JSON.stringify(r, null, 1))
}
export async function removeRule(id: string): Promise<void> {
  const r = await loadRules()
  await writeFileAtomic(file(), JSON.stringify({ accepted: r.accepted.filter((x) => x.id !== id), rejected: r.rejected.filter((x) => x !== id) }, null, 1))
}

/** Nur bestätigte Regeln wirken, und nur auf neu berechnete Clips. */
export async function applyAcceptedRules<C extends { start: number; end: number; firstWord: number; lastWord: number }>(clips: C[], words: Array<{ start: number; end: number }>, durationSec: number): Promise<C[]> {
  const { accepted } = await loadRules()
  return accepted.length ? clips.map((c) => applyRules(c, words, accepted, durationSec)) : clips
}
