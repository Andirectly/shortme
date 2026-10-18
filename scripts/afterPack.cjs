// electron-builder afterPack: Logo als Exe-Icon einbetten (signAndEditExecutable=false lässt das sonst aus – winCodeSign braucht Symlink-Rechte)
const path = require('path')
exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return
  const { rcedit } = require('rcedit')
  const exe = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`)
  await rcedit(exe, { icon: path.join(context.packager.projectDir, 'build', 'icon.ico'), 'version-string': { ProductName: 'Shortme', FileDescription: 'Shortme', InternalName: 'Shortme', OriginalFilename: 'Shortme.exe' } })
  console.log('  • Exe-Icon gesetzt:', exe)
}
