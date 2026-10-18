/** Entscheidungen aus dem Testlab (Zustand im Datenordner) in resources/models-catalog.json und docs/MODELS.md nachtragen.
 *   SHORTME_DATA=<Datenordner der App> npx tsx --tsconfig tsconfig.node.json scripts/sync-models-docs.ts
 * Installierte App: Datenordner = %APPDATA%\Shortme (enthält models-state.json). */
import { syncFiles } from '../src/main/testlab/registry'

syncFiles().then(() => { console.log('PASS docs/MODELS.md und resources/models-catalog.json aktualisiert'); process.exit(0) }).catch((e) => { console.error('FAIL', e); process.exit(1) })
