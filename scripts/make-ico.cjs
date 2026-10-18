// build/icon.png → build/icon.ico (PNG-in-ICO, 16–256 px) – einmalig nach Logo-Änderung: node scripts/make-ico.cjs
const { execFileSync } = require('child_process')
const fs = require('fs')
const ff = require('ffmpeg-static')
const sizes = [16, 24, 32, 48, 64, 128, 256]
const pngs = sizes.map((s) => {
  const out = `.tmp/ico-${s}.png`
  execFileSync(ff, ['-hide_banner', '-loglevel', 'error', '-y', '-i', 'build/icon.png', '-vf', `scale=${s}:${s}:flags=lanczos`, out])
  return fs.readFileSync(out)
})
const head = Buffer.alloc(6); head.writeUInt16LE(1, 2); head.writeUInt16LE(sizes.length, 4)
let offset = 6 + 16 * sizes.length
const dir = Buffer.concat(sizes.map((s, i) => {
  const e = Buffer.alloc(16); e[0] = s === 256 ? 0 : s; e[1] = s === 256 ? 0 : s; e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6); e.writeUInt32LE(pngs[i].length, 8); e.writeUInt32LE(offset, 12); offset += pngs[i].length; return e
}))
fs.writeFileSync('build/icon.ico', Buffer.concat([head, dir, ...pngs]))
console.log('build/icon.ico', offset, 'Bytes')
