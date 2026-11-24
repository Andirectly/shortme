// from: denislupookov/altersend@8c23d5b7d50cedae6c9dae66f82b1e235070c16a/packages/drive/src/adapters/read-range.ts (Apache-2.0, see src/main/remote/drive/NOTICE)
import type { FileHandle } from 'node:fs/promises'

export async function readRange(
  handle: FileHandle,
  offset: number,
  length: number
): Promise<Uint8Array> {
  const buffer = new Uint8Array(length)
  const { bytesRead } = await handle.read(buffer, 0, length, offset)
  return bytesRead === length ? buffer : buffer.subarray(0, bytesRead)
}
