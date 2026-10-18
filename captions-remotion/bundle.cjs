// Remotion-Bundle erzeugen (Entwicklung: bei Bedarf; Paketierung: einmal vor electron-builder → resources/remotion-bundle).
// Aufruf: node remotion/bundle.cjs <Zielordner>
const fs = require('fs')
const os = require('os')
const path = require('path')

async function bundleRemotion(outDir, onProgress) {
  const { bundle } = require('@remotion/bundler')
  const root = path.resolve(__dirname, '..')
  // Schriften als Remotion-`public`-Ordner (staticFile('fonts/…'))
  const pub = fs.mkdtempSync(path.join(os.tmpdir(), 'shortme-rm-public-'))
  fs.mkdirSync(path.join(pub, 'fonts'))
  for (const f of fs.readdirSync(path.join(root, 'resources/fonts'))) if (/\.(ttf|otf)$/i.test(f)) fs.copyFileSync(path.join(root, 'resources/fonts', f), path.join(pub, 'fonts', f))
  fs.rmSync(outDir, { recursive: true, force: true })
  const out = await bundle({
    entryPoint: path.join(__dirname, 'index.ts'),
    outDir,
    publicDir: pub,
    onProgress: (p) => onProgress && onProgress(p / 100),
    webpackOverride: (config) => ({ ...config, resolve: { ...config.resolve, alias: { ...(config.resolve ? config.resolve.alias : {}), '@shared': path.join(root, 'src/shared') } } })
  })
  fs.rmSync(pub, { recursive: true, force: true })
  return out
}

module.exports = { bundleRemotion }

if (require.main === module) {
  const out = path.resolve(process.argv[2] || 'resources/remotion-bundle')
  const t0 = Date.now()
  bundleRemotion(out, (p) => { if (Math.round(p * 100) % 25 === 0) process.stdout.write(`\r  Bundle ${Math.round(p * 100)} %`) }).then(() => console.log(`\nRemotion-Bundle: ${out} (${((Date.now() - t0) / 1000).toFixed(0)} s)`)).catch((e) => { console.error(e); process.exit(1) })
}
