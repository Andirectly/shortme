import { jobs } from '../shortme/ipc'
import { rebuildDataset, scheduleRebuild, setBusyProbe } from './dataset'
import { collecting, onLearnChange } from './store'

export function registerLearnIpc(): void {
  onLearnChange(() => scheduleRebuild())
  setBusyProbe(() => jobs.list().some((j) => j.state === 'running'))
  // Beim Start nachträglich eintragen, was schon da ist (verzögert, damit der Start nicht langsamer wird)
  setTimeout(() => void collecting().then(async (on) => { if (on) await rebuildDataset() }).catch((e) => console.error('Datensatz:', e)), 120_000).unref()
}
