// Optionaler Twitch-Token (auth-token-Cookie des eigenen Kontos): liegt in der Windows-Anmeldeinformationsverwaltung
// (Ziel „Shortme/Twitch“), nie im Klartext in Dateien oder Projekt-JSON. Zugriff über PowerShell + advapi32 (kein natives Modul nötig).
import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { dataRoot } from '../engines/paths'

const TARGET = 'Shortme/Twitch'

const PS = `
param([string]$Mode, [string]$Target)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class Cred {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct CREDENTIAL { public int Flags; public int Type; public string TargetName; public string Comment; public long LastWritten; public int CredentialBlobSize; public IntPtr CredentialBlob; public int Persist; public int AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName; }
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool CredWriteW(ref CREDENTIAL c, int flags);
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool CredReadW(string target, int type, int flags, out IntPtr p);
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool CredDeleteW(string target, int type, int flags);
  [DllImport("advapi32.dll")] static extern void CredFree(IntPtr p);
  public static void Write(string target, string secret) {
    byte[] b = Encoding.Unicode.GetBytes(secret);
    IntPtr mem = Marshal.AllocHGlobal(b.Length);
    Marshal.Copy(b, 0, mem, b.Length);
    CREDENTIAL c = new CREDENTIAL(); c.Type = 1; c.TargetName = target; c.CredentialBlobSize = b.Length; c.CredentialBlob = mem; c.Persist = 2; c.UserName = "Shortme";
    bool ok = CredWriteW(ref c, 0);
    Marshal.FreeHGlobal(mem);
    if (!ok) throw new Exception("CredWrite " + Marshal.GetLastWin32Error());
  }
  public static string Read(string target) {
    IntPtr p; if (!CredReadW(target, 1, 0, out p)) return null;
    try { CREDENTIAL c = (CREDENTIAL)Marshal.PtrToStructure(p, typeof(CREDENTIAL)); return Marshal.PtrToStringUni(c.CredentialBlob, c.CredentialBlobSize / 2); } finally { CredFree(p); }
  }
  public static void Delete(string target) { CredDeleteW(target, 1, 0); }
}
"@
if ($Mode -eq 'set') { $s = [Console]::In.ReadToEnd().Trim(); [Cred]::Write($Target, $s) }
elseif ($Mode -eq 'get') { $v = [Cred]::Read($Target); if ($v) { [Console]::Out.Write($v) } }
elseif ($Mode -eq 'has') { if ([Cred]::Read($Target)) { [Console]::Out.Write('1') } else { [Console]::Out.Write('0') } }
elseif ($Mode -eq 'del') { [Cred]::Delete($Target) }
`

let scriptPath: string | null = null
async function script(): Promise<string> {
  if (scriptPath) return scriptPath
  const dir = join(dataRoot(), 'bin')
  await mkdir(dir, { recursive: true })
  scriptPath = join(dir, 'cred.ps1')
  await writeFile(scriptPath, PS, 'utf8')
  return scriptPath
}

async function run(mode: 'set' | 'get' | 'has' | 'del', stdin?: string, target = TARGET): Promise<string> {
  if (process.platform !== 'win32') throw new Error('Token-Speicher nur unter Windows')
  const file = await script()
  return new Promise((resolve, reject) => {
    const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file, mode, target], { windowsHide: true })
    let out = ''
    let err = ''
    p.stdout.on('data', (d: Buffer) => (out += d))
    p.stderr.on('data', (d: Buffer) => (err += d))
    p.on('error', reject)
    p.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`Anmeldeinformationen: ${err.trim().slice(0, 200)}`))))
    p.stdin.end(stdin ?? '')
  })
}

export const saveTwitchToken = async (token: string): Promise<void> => { await run('set', token.trim().replace(/^OAuth\s+/i, '')) }
export const clearTwitchToken = async (): Promise<void> => { await run('del') }
export const hasTwitchToken = async (): Promise<boolean> => { try { return (await run('has')) === '1' } catch { return false } }
export const readTwitchToken = async (): Promise<string | null> => { try { return (await run('get')).trim() || null } catch { return null } }

/** Beliebige Geheimnisse (Upload-Plattformen) im selben Speicher unter eigenem Ziel, z. B. „Shortme/TikTok/token“. */
export const secretSet = (target: string, value: string): Promise<string> => run('set', value, target)
export const secretDel = (target: string): Promise<string> => run('del', undefined, target)
export const secretGet = async (target: string): Promise<string | null> => { try { return (await run('get', undefined, target)).trim() || null } catch { return null } }
