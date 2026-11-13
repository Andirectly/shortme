// Neue Engine (Beta): wird in den folgenden Schritten ausgebaut. Bis dahin meldet sie klar, dass sie noch nicht bereit ist (kein stiller Rückgriff auf Legacy).
import type { SelectionOutcome, SelectionRequest } from '..'

export async function selectV2(_req: SelectionRequest): Promise<SelectionOutcome> {
  throw new Error('Die neue Engine ist noch nicht fertig eingerichtet.')
}
