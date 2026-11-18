// Baut den Swift-Helfer der Mac-Engine (native/mac-worker) – nur auf macOS, sonst nichts zu tun.
import { spawnSync } from 'node:child_process'
if (process.platform !== 'darwin') process.exit(0)
const r = spawnSync('swift', ['build', '-c', 'release', '--package-path', 'native/mac-worker'], { stdio: 'inherit' })
process.exit(r.status ?? 1)
